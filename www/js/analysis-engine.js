/**
 * AnalysisEngine - محرك التحليل
 * يدير تواصل Stockfish مع مستويات تحليل مختلفة
 * يعمل مع Stockfish 18 WASM في بيئة Capacitor
 */

class AnalysisEngine {
  constructor(options = {}) {
    this.worker = null;
    this.isReady = false;
    this.messageBuffer = [];
    this.pendingResolve = null;
    this.pendingReject = null;
    this.analysisTimeout = null;
    this.onMessage = options.onMessage || null;

    // مسار Stockfish - يمكن تغييره حسب موقعه في المشروع
    this.stockfishPath = options.stockfishPath || 'stockfish.js';

    // تعريف مستويات التحليل
    this.LEVELS = {
      WEAK: {
        id: 'WEAK',
        nameAr: 'ضعيف / سريع',
        nameEn: 'Fast',
        icon: '⚡',
        depth: 10,
        movetime: 500,
        descriptionAr: 'مناسب للمراجعة السريعة واستهلاك موارد أقل',
        color: '#76b041'
      },
      MEDIUM: {
        id: 'MEDIUM',
        nameAr: 'متوسط',
        nameEn: 'Balanced',
        icon: '⚖️',
        depth: 16,
        movetime: 2000,
        descriptionAr: 'توازن بين السرعة وقوة التحليل',
        color: '#f0c816'
      },
      STRONG: {
        id: 'STRONG',
        nameAr: 'قوي / عميق',
        nameEn: 'Deep',
        icon: '🔬',
        depth: 22,
        movetime: 5000,
        descriptionAr: 'تحليل دقيق - يستغرق وقتاً أطول للحصول على أفضل النتائج',
        color: '#e6912c'
      }
    };

    this.currentLevel = 'MEDIUM';
    this._lastAnalysis = null;
  }

  // تهيئة المحرك
  async initialize() {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(this.stockfishPath);
      } catch (e) {
        reject(new Error('لم يتم العثور على ملف Stockfish في المسار: ' + this.stockfishPath));
        return;
      }

      let initTimeout = setTimeout(() => {
        reject(new Error('انتهى وقت الانتظار. تأكد من أن stockfish.js موجود في مجلد www'));
      }, 15000);

      this.worker.onmessage = (e) => {
        const msg = typeof e.data === 'string' ? e.data : String(e.data || '');
        this.messageBuffer.push(msg);

        if (this.onMessage) this.onMessage(msg);

        if (msg === 'uciok') {
          this.isReady = true;
          clearTimeout(initTimeout);
          // إعدادات ابتدائية
          this.worker.postMessage('setoption name Hash value 32');
          this.worker.postMessage('setoption name Threads value 1');
          this.worker.postMessage('isready');
        }

        if (msg === 'readyok') {
          resolve(true);
        }

        // معالجة رسائل التحليل الجاري
        if (this.pendingResolve) {
          this._processLine(msg);
        }
      };

      this.worker.onerror = (e) => {
        clearTimeout(initTimeout);
        reject(new Error('خطأ في Stockfish: ' + e.message));
      };

      this.worker.postMessage('uci');
    });
  }

  // معالجة رسالة واحدة من المحرك
  _processLine(line) {
    if (line.startsWith('bestmove')) {
      clearTimeout(this.analysisTimeout);
      const analysis = this._parseResults();
      const parts = line.split(' ');
      analysis.bestMove = parts[1] !== '(none)' ? parts[1] : null;
      analysis.ponder = parts[3] || null;
      this._lastAnalysis = analysis;
      if (this.pendingResolve) {
        this.pendingResolve(analysis);
        this.pendingResolve = null;
        this.pendingReject = null;
      }
    }
  }

  // تحليل جميع رسائل info وتجميع النتائج
  _parseResults() {
    const result = {
      bestMove: null,
      ponder: null,
      score: null,
      scoreCp: null,
      depth: 0,
      lines: [],
      level: this.currentLevel
    };

    const lineMap = {};

    for (const line of this.messageBuffer) {
      if (!line.startsWith('info') || !line.includes('pv')) continue;

      const depthMatch = line.match(/\bdepth (\d+)/);
      const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
      const pvMatch = line.match(/\bpv (.+)/);
      const mpvMatch = line.match(/\bmultipv (\d+)/);
      const nodesMatch = line.match(/\bnodes (\d+)/);

      if (!scoreMatch || !pvMatch) continue;

      const depth = depthMatch ? parseInt(depthMatch[1]) : 0;
      const mpv = mpvMatch ? parseInt(mpvMatch[1]) : 1;
      const pv = pvMatch[1].trim().split(/\s+/);
      const scoreType = scoreMatch[1];
      const scoreVal = parseInt(scoreMatch[2]);

      const key = mpv;
      if (!lineMap[key] || depth > lineMap[key].depth) {
        lineMap[key] = {
          multipv: mpv,
          depth,
          score: { type: scoreType, value: scoreVal },
          pv,
          nodes: nodesMatch ? parseInt(nodesMatch[1]) : 0
        };
      }
    }

    result.lines = Object.values(lineMap).sort((a, b) => a.multipv - b.multipv);

    if (result.lines.length > 0) {
      result.score = result.lines[0].score;
      result.depth = result.lines[0].depth;
      result.scoreCp = result.score.type === 'cp' ? result.score.value :
        (result.score.value > 0 ? 30000 - result.score.value * 100 : -30000 - result.score.value * 100);
    }

    return result;
  }

  // تحليل وضعية معينة
  async analyzePosition(fen, options = {}) {
    if (!this.worker || !this.isReady) {
      throw new Error('المحرك غير جاهز. استدعِ initialize() أولاً');
    }

    // إيقاف أي تحليل سابق
    this.stopAnalysis();

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.messageBuffer = [];

      const level = this.LEVELS[this.currentLevel];
      const numLines = options.multiPV || 1;
      const depth = options.depth || level.depth;
      const movetime = options.movetime || level.movetime;
      const moves = options.moves || '';

      // إعداد الوضعية
      this.worker.postMessage('ucinewgame');
      this.worker.postMessage('setoption name MultiPV value ' + numLines);

      if (moves) {
        this.worker.postMessage('position fen ' + fen + ' moves ' + moves);
      } else {
        this.worker.postMessage('position fen ' + fen);
      }

      // بدء التحليل
      if (options.useMovetime) {
        this.worker.postMessage('go movetime ' + movetime);
      } else {
        this.worker.postMessage('go depth ' + depth);
      }

      // timeout للأمان
      const timeoutMs = Math.max(movetime * 2, 30000);
      this.analysisTimeout = setTimeout(() => {
        this.worker.postMessage('stop');
      }, timeoutMs);
    });
  }

  // إيقاف التحليل الجاري
  stopAnalysis() {
    if (this.analysisTimeout) {
      clearTimeout(this.analysisTimeout);
      this.analysisTimeout = null;
    }
    if (this.worker && this.pendingResolve) {
      this.worker.postMessage('stop');
    }
  }

  // تحويل التقييم إلى نص مقروء
  static scoreToText(score) {
    if (!score) return '+0.00';
    if (score.type === 'mate') {
      return score.value > 0 ? `M${score.value}` : `-M${Math.abs(score.value)}`;
    }
    const val = score.value / 100;
    return val >= 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
  }

  // حساب الفرق بين تقييمين بالسنتيبون
  static cpLoss(cpBefore, cpAfter, isWhite) {
    if (cpBefore === null || cpAfter === null) return 0;
    // من منظور اللاعب الذي يحرك
    const evalBefore = isWhite ? cpBefore : -cpBefore;
    const evalAfter = isWhite ? cpAfter : -cpAfter;
    return Math.max(0, evalBefore - evalAfter);
  }

  // تصنيف النقلة بناءً على فقدان النقاط
  static classifyMove(cpLoss) {
    if (cpLoss < 5)   return { type: 'brilliant',   symbol: '!!', labelAr: 'رائع',       color: '#1bade4', bg: '#0d2a3d' };
    if (cpLoss < 15)  return { type: 'excellent',   symbol: '!',  labelAr: 'ممتاز',      color: '#0dbd8b', bg: '#0d3328' };
    if (cpLoss < 30)  return { type: 'good',        symbol: '',   labelAr: 'جيد',         color: '#76b041', bg: '#1e2d14' };
    if (cpLoss < 70)  return { type: 'inaccuracy',  symbol: '?!', labelAr: 'غير دقيق',   color: '#f0c816', bg: '#2d2900' };
    if (cpLoss < 150) return { type: 'mistake',     symbol: '?',  labelAr: 'خطأ',         color: '#e6912c', bg: '#2d1c00' };
    return              { type: 'blunder',      symbol: '??', labelAr: 'خطأ فادح',   color: '#ca3431', bg: '#2d0a09' };
  }

  setLevel(level) {
    if (this.LEVELS[level]) {
      this.currentLevel = level;
    }
  }

  getLevel() {
    return this.LEVELS[this.currentLevel];
  }

  getAllLevels() {
    return Object.values(this.LEVELS);
  }

  destroy() {
    this.stopAnalysis();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
  }
}

// تصدير للاستخدام في صفحات أخرى
if (typeof window !== 'undefined') window.AnalysisEngine = AnalysisEngine;
if (typeof module !== 'undefined') module.exports = AnalysisEngine;
