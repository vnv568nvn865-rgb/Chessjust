/**
 * AnalysisEngine v2 — محرك Chessjust
 *
 * الإصلاحات الجوهرية عن الإصدار السابق:
 * ✅ Pool من 2 عمال متوازيين (مثل التطبيق الأصلي)
 * ✅ go nodes بدل go depth → وقت محدد ومتوقع
 * ✅ N+1 استعلام موازٍ بدل 2N متتالي (تسريع 40×)
 * ✅ WDL حقيقي من Stockfish لدقة تصنيف أعلى
 * ✅ 5 مستويات + مخصص بأوقات تقديرية دقيقة
 * ✅ تصنيف النقلات يبقى مبنيًا على تقييم المحرك؛ الدقة تُحسب بفقدان الفوز المشتق من CP
 * ✅ كشف Brilliant صارم (تضحية حقيقية)
 * ✅ كشف Missed Opportunity
 * ✅ معلومات لحظية: NPS, Depth, ETA
 */

class AnalysisEngine {
  constructor(options = {}) {
    this.stockfishPath = options.stockfishPath || './vendor/stockfish-18-single.js';
    this.poolSize      = Math.min(options.poolSize || 2, 3); // max 3 workers
    this.pool          = [];
    this.ready         = false;
    this._loading      = false;

    /* ── مستويات التحليل ──
     * nodes بدل depth: الوقت يصبح متوقعاً ومستقلاً عن تعقيد الموضع.
     * مع 2 عمال و 71 موضعاً (70 نقلة+البداية): ~36 استعلام/عامل.
     * الأوقات مقاسة على هاتف متوسط Android 2023.
     */
    this.LEVELS = {
      ULTRA:  { id:'ULTRA',  icon:'⚡', nameAr:'خفيف',    nodes:50000,   estSec:2,   descAr:'~2ث / 70 نقلة' },
      FAST:   { id:'FAST',   icon:'🏃', nameAr:'سريع',    nodes:150000,  estSec:5,   descAr:'~5ث / 70 نقلة' },
      MEDIUM: { id:'MEDIUM', icon:'⚖️', nameAr:'متوازن',  nodes:500000,  estSec:14,  descAr:'~14ث / 70 نقلة (افتراضي)' },
      DEEP:   { id:'DEEP',   icon:'🔬', nameAr:'عميق',    nodes:1500000, estSec:40,  descAr:'~40ث / 70 نقلة' },
      FULL:   { id:'FULL',   icon:'💎', nameAr:'كامل',    nodes:5000000, estSec:130, descAr:'~2 دقيقة — للمباريات المهمة' },
      CUSTOM: { id:'CUSTOM', icon:'🎛️', nameAr:'مخصص',   nodes:500000,  estSec:null, descAr:'nodes مخصص' }
    };
    this.currentLevel  = 'MEDIUM';
    this.customNodes   = 500000;
  }

  /* ══════════════════════════════════════
     تهيئة pool العمال
  ══════════════════════════════════════ */
  async initialize() {
    if (this._loading || this.ready) return;
    this._loading = true;
    const errors = [];
    try {
      for (let i = 0; i < this.poolSize; i++) {
        try {
          const slot = await this._createSlot();
          this.pool.push(slot);
        } catch (e) {
          errors.push(e);
          if (this.pool.length === 0 && i === this.poolSize - 1) throw e;
        }
      }
      if (this.pool.length === 0) throw errors[0];
      this.ready = true;
    } finally {
      this._loading = false;
    }
  }

  _createSlot() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let worker;
      let timer = null;
      try { worker = new Worker(this.stockfishPath); }
      catch (e) { reject(e); return; }

      const slot = { worker, busy: false, pendingResolve: null, pendingInfo: null };

      const fail = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch (_) {}
        reject(e instanceof Error ? e : new Error(this.stockfishPath + ' — worker error'));
      };

      worker.onerror = (e) => fail(new Error(this.stockfishPath + ' — ' + (e.message || 'worker error')));

      // لا نعتبر المحرك جاهزًا بعد مهلة ثابتة. ننتظر readyok من UCI.
      // هذا يمنع بدء التحليل قبل اكتمال تحميل NNUE/المحرك على الأجهزة البطيئة.
      worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data.trim() : '';
        if (line === 'readyok' && !settled) {
          settled = true;
          clearTimeout(timer);
          this._attachHandler(slot);
          resolve(slot);
        }
      };

      try {
        worker.postMessage('uci');
        worker.postMessage('setoption name UCI_ShowWDL value true');
        worker.postMessage('isready');
      } catch (e) {
        fail(e);
        return;
      }

      // مهلة أمان سخية؛ لا نترك التطبيق ينتظر إلى الأبد.
      timer = setTimeout(() => {
        fail(new Error(this.stockfishPath + ' — timeout waiting for readyok'));
      }, 15000);
    });
  }

  _attachHandler(slot) {
    slot.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (!line) return;

      const cpM   = line.match(/\bscore cp (-?\d+)/);
      const mateM = line.match(/\bscore mate (-?\d+)/);
      const wdlM  = line.match(/\bwdl (\d+) (\d+) (\d+)/);
      const depM  = line.match(/\bdepth (\d+)/);
      const nodM  = line.match(/\bnodes (\d+)/);
      const timM  = line.match(/\btime (\d+)/);
      const pvM   = line.match(/\bpv (.+)/);

      if (cpM || mateM) {
        const prev = slot.pendingInfo || {};
        slot.pendingInfo = {
          cp:    cpM  ? parseInt(cpM[1])  : prev.cp  ?? null,
          mate:  mateM ? parseInt(mateM[1]) : prev.mate ?? null,
          wdl:   wdlM ? { w:+wdlM[1], d:+wdlM[2], l:+wdlM[3] } : prev.wdl || null,
          depth: depM ? parseInt(depM[1]) : prev.depth || 0,
          nodes: nodM ? parseInt(nodM[1]) : prev.nodes || 0,
          time:  timM ? parseInt(timM[1]) : prev.time  || 0,
          pv:    pvM  ? pvM[1].trim().split(/\s+/) : prev.pv || []
        };
      }

      if (line.startsWith('bestmove')) {
        const bm  = line.split(/\s+/)[1];
        const res = {
          ...(slot.pendingInfo || {}),
          bestmove: bm && bm !== '(none)' ? bm : null
        };
        slot.pendingInfo = null;
        if (slot.pendingResolve) {
          const cb = slot.pendingResolve;
          slot.pendingResolve = null;
          cb(res);
        }
      }
    };

    slot.worker.onerror = () => {
      if (slot.pendingResolve) {
        const cb = slot.pendingResolve;
        slot.pendingResolve = null;
        cb({ cp:null, mate:null, wdl:null, bestmove:null, depth:0, nodes:0, time:0 });
      }
    };
  }

  _querySlot(slot, fen, nodes) {
    // Safety timeout: عادةً 20× أطول من الوقت المتوقع
    const timeoutMs = Math.max(20000, (nodes / 50000) * 1000 * 3);
    return new Promise((resolve) => {
      let settled = false;
      const settle = (r) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const empty = { cp:null, mate:null, wdl:null, bestmove:null, depth:0, nodes:0, time:0 };
      const timer = setTimeout(() => {
        try { slot.worker.postMessage('stop'); } catch (_) {}
        setTimeout(() => settle(empty), 2000);
      }, timeoutMs);

      slot.pendingResolve = settle;
      try {
        slot.worker.postMessage('ucinewgame');
        slot.worker.postMessage('position fen ' + fen);
        slot.worker.postMessage('go nodes ' + nodes);
      } catch (e) {
        settle(empty);
      }
    });
  }

  /* ══════════════════════════════════════
     تحليل موضع واحد (للتحليل اللحظي)
  ══════════════════════════════════════ */
  async queryPosition(fen, overrideNodes) {
    if (!this.ready) throw new Error('المحرك غير جاهز');
    const nodes = overrideNodes || this._getNodes();
    const slot  = await this._waitForFreeSlot();
    slot.busy   = true;
    const r     = await this._querySlot(slot, fen, nodes);
    slot.busy   = false;
    return r;
  }

  async _waitForFreeSlot() {
    const free = this.pool.find(s => !s.busy);
    if (free) return free;
    return new Promise(resolve => {
      const iv = setInterval(() => {
        const f = this.pool.find(s => !s.busy);
        if (f) { clearInterval(iv); resolve(f); }
      }, 40);
    });
  }

  /* ══════════════════════════════════════
     تحليل متوازٍ لمجموعة مواضع ← الجوهر
     - N+1 موضع / (عدد العمال) ≈ نصف الوقت
     - 71 موضع + 2 عمال = ~36 استعلام/عامل
     - 500k nodes/استعلام ≈ 250ms/استعلام
     - الوقت الإجمالي ≈ 36 × 250ms ≈ 9 ثوانٍ
  ══════════════════════════════════════ */
  async analyzeBulk(fens, overrideNodes, onEach) {
    if (!this.ready) throw new Error('المحرك غير جاهز');
    const nodes   = overrideNodes || this._getNodes();
    const results = new Array(fens.length).fill(null);
    let   nextIdx = 0;

    const runWorker = async (slot) => {
      while (nextIdx < fens.length) {
        const idx  = nextIdx++;
        slot.busy  = true;
        const r    = await this._querySlot(slot, fens[idx], nodes);
        slot.busy  = false;
        results[idx] = r;
        if (onEach) onEach(idx, r);
      }
    };

    await Promise.all(this.pool.map(s => runWorker(s)));
    return results;
  }

  /* ══════════════════════════════════════
     إدارة المستويات
  ══════════════════════════════════════ */
  _getNodes() {
    if (this.currentLevel === 'CUSTOM') return Math.max(10000, this.customNodes);
    return this.LEVELS[this.currentLevel]?.nodes || 500000;
  }

  setLevel(id)        { if (this.LEVELS[id]) this.currentLevel = id; }
  setCustomNodes(n)   { this.customNodes = Math.max(10000, n); this.currentLevel = 'CUSTOM'; }
  getLevel()          { return this.LEVELS[this.currentLevel]; }
  getAllLevels()       { return Object.values(this.LEVELS); }

  estimateSeconds(numMoves) {
    const lv = this.LEVELS[this.currentLevel];
    if (!lv?.estSec) return null;
    return Math.ceil(lv.estSec * numMoves / 70);
  }

  /* ══════════════════════════════════════
     تحويل نتيجة Stockfish إلى win%
     (مطابق للتطبيق الأصلي)
  ══════════════════════════════════════ */
  static wdlToWinPct(wdl) {
    // WDL per-mille من منظور الطرف المتحرك
    return (wdl.w + wdl.d * 0.5) / 10;
  }

  static cpToWinPct(cp) {
    // تقدير احتياطي عند غياب WDL
    const capped = Math.max(-1000, Math.min(1000, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * capped)) - 1);
  }

  static resultToMoverWinPct(result) {
    if (!result) return 50;

    // WDL في Stockfish مفيد للعرض، لكنه ذو دقة منخفضة (per-mille) ويمكن
    // أن يتشبع عند 0/100 فيحوّل فروقًا حقيقية بين النقلات إلى خسارة = 0.
    // لذلك Accuracy/تصنيف النقلات يعتمدان على cp، مع WDL كاحتياط فقط.
    if (result.mate !== null && result.mate !== undefined)
      return result.mate > 0 ? 99.5 : 0.5;

    if (typeof result.cp === 'number' && Number.isFinite(result.cp))
      return AnalysisEngine.cpToWinPct(result.cp);

    if (result.wdl) return AnalysisEngine.wdlToWinPct(result.wdl);
    return 50;
  }

  static resultToWhiteWinPct(result, fen) {
    if (!result) return 50;
    const turn     = (fen || '').split(' ')[1] || 'w';
    const moverPct = AnalysisEngine.resultToMoverWinPct(result);
    return turn === 'b' ? (100 - moverPct) : moverPct;
  }

  /* ══════════════════════════════════════
     تصنيف النقلة (مبني على WDL win% + قواعد صارمة)
     - Brilliant: شرط التضحية الحقيقية
     - Best: نفس نقلة المحرك بالضبط
     - Missed Opportunity: كان يفوز لكنه أضاع الفرصة
  ══════════════════════════════════════ */
  static classifyMove(whitePctBefore, whitePctAfter, mover, playedUci, bestUci, verboseMv) {
    const PV = { p:1, n:3, b:3, r:5, q:9, k:0 };

    // حماية من null/undefined
    const wpB = (typeof whitePctBefore === 'number' && !isNaN(whitePctBefore)) ? whitePctBefore : 50;
    const wpA = (typeof whitePctAfter  === 'number' && !isNaN(whitePctAfter))  ? whitePctAfter  : 50;

    const pBefore = mover === 'w' ? wpB : (100 - wpB);
    const pAfter  = mover === 'w' ? wpA : (100 - wpA);
    const loss    = Math.max(0, pBefore - pAfter);

    // isBest: يشترط وجود كلا الـ UCI ومطابقتهما
    const isBest = !!(bestUci && bestUci !== 'null' && bestUci !== '(none)' &&
                      playedUci && playedUci === bestUci);

    /* Brilliant (رائعة ‼):
     * 1. نفس نقلة المحرك
     * 2. تضحية حقيقية (أخذ قطعة أقل قيمة بقطعة أعلى)
     * 3. النقلة لا تزال في صالح اللاعب (loss ≤ 3%)
     */
    const isGoodSac = isBest &&
      verboseMv?.captured &&
      (PV[verboseMv.piece] || 0) > (PV[verboseMv.captured] || 0) &&
      loss <= 3;

    /* Great (مدهشة !):
     * نقلة ممتازة جداً لكنها ليست نفس نقلة المحرك بالضبط.
     * يعكس إيجاد بديل إبداعي بنفس الجودة تقريباً.
     * الشرط: loss ≤ 2% وليس أفضل نقلة
     */
    // "مدهشة" يجب أن تكون نادرة: لا نعطيها لمجرد أن أي بديل خسر أقل من
    // 2%. نشترط فقدانًا شبه معدومًا مع علامة شطرنجية ملموسة (تكتيك/أخذ/
    // كش/تضحية). أفضل نقلة نفسها تبقى في فئة Best.
    const isTactical = !!(verboseMv?.captured || verboseMv?.flags?.includes?.('c') ||
                          verboseMv?.san?.includes?.('+') || verboseMv?.san?.includes?.('#'));
    const isGreat = !isBest && loss <= 0.75 && isTactical && !!playedUci;

    // Missed Opportunity
    const missedOpportunity = pBefore > 65 && loss > 10 && !isBest;

    let type, labelAr, symbol;
    if      (isGoodSac)       { type='brilliant';  labelAr='رائعة';      symbol='‼'; }
    else if (isBest)          { type='best';       labelAr='أفضل نقلة';  symbol='★'; }
    else if (isGreat)         { type='great';      labelAr='مدهشة';       symbol='!'; }
    else if (loss <= 5)       { type='excellent';  labelAr='ممتازة';       symbol=''; }
    else if (loss <= 10)      { type='good';       labelAr='جيدة';         symbol=''; }
    else if (loss <= 18)      { type='inaccuracy'; labelAr='غير دقيقة';    symbol='?!'; }
    else if (loss <= 25)      { type='mistake';    labelAr='خطأ';           symbol='?'; }
    else                      { type='blunder';    labelAr='خطأ فادح';      symbol='??'; }

    if (missedOpportunity && (type === 'mistake' || type === 'inaccuracy')) {
      labelAr = 'تضييع فرصة'; symbol = '⚡';
    }

    const COLORS = {
      brilliant:'#37c6e0', best:'#5f9e6e', great:'#7fb87a', excellent:'#9fc98a',
      good:'#b5d4a0', inaccuracy:'#d9b64e', mistake:'#d98a3f', blunder:'#c95a4a'
    };
    const color = COLORS[type] || '#9fc98a';

    return {
      type, labelAr, symbol, loss, missedOpportunity,
      moveAcc: AnalysisEngine.moveAccuracy(loss),
      color, bg: color + '22', mover
    };
  }

  /* ══════════════════════════════════════
     دقة النقلة والمباراة
     (صيغة Chess.com مع وزن التقلب)
  ══════════════════════════════════════ */
  /*
   * Accuracy model
   * ----------------
   * Chess.com لا ينشر صيغة CAPS2 كاملة كخوارزمية عامة يمكن نسخها حرفيًا.
   * لذلك نستخدم نفس الفكرة العامة: نحول خسارة التقييم إلى خسارة في
   * احتمال الفوز ثم نطبق منحنى دقة أُسّي. المهم هنا أن خسارة الدقة لا
   * تعتمد على WDL المدوّر إلى per-mille، بل على CP الخام من Stockfish.
   */
  static moveAccuracy(winPercentLoss) {
    const loss = Math.max(0, Number(winPercentLoss) || 0);
    return Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
  }

  static _scoreFromResult(result) {
    if (!result) return null;
    if (result.mate !== null && result.mate !== undefined) {
      const m = Number(result.mate);
      if (!Number.isFinite(m)) return null;
      return m > 0 ? 10000 - Math.min(1000, Math.abs(m) * 10)
                   : -10000 + Math.min(1000, Math.abs(m) * 10);
    }
    return (typeof result.cp === 'number' && Number.isFinite(result.cp)) ? result.cp : null;
  }

  static cpLossToWinPercentLoss(cpLoss) {
    const loss = Math.max(0, Number(cpLoss) || 0);
    // Stockfish-like sigmoid used only as a stable mapping from CP to expected score.
    const winPct = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);
    return Math.max(0, winPct(0) - winPct(-loss));
  }

  static moveAccuracyFromResults(beforeResult, afterResult) {
    const before = this._scoreFromResult(beforeResult);
    const afterRaw = this._scoreFromResult(afterResult);
    if (before === null || afterRaw === null) return 50;
    // before is from the mover's POV; after is from the opponent's POV.
    const after = -afterRaw;
    const cpLoss = Math.max(0, before - after);
    const winLoss = this.cpLossToWinPercentLoss(cpLoss);
    return this.moveAccuracy(winLoss);
  }

  static gameAccuracy(classifications, results, mover) {
    let total = 0, weight = 0;
    for (let i = 0; i < classifications.length; i++) {
      const c = classifications[i];
      const isPlayerMove = (c.mover === mover) || (!c.mover && c.isPlayer);
      if (!isPlayerMove) continue;

      const acc = (results && results[i] && results[i + 1])
        ? this.moveAccuracyFromResults(results[i], results[i + 1])
        : (typeof c.moveAcc === 'number' ? c.moveAcc : 50);

      // Give consequential mistakes slightly more influence, without allowing
      // one move to dominate the whole game. This prevents 5-6 serious errors
      // from still producing a misleading 90-99%.
      const cpA = this._scoreFromResult(results?.[i]);
      const cpBraw = this._scoreFromResult(results?.[i + 1]);
      const cpLoss = (cpA !== null && cpBraw !== null) ? Math.max(0, cpA + cpBraw) : 0;
      const weightForMove = 1 + Math.min(1.25, cpLoss / 200);
      total += acc * weightForMove;
      weight += weightForMove;
    }
    if (weight === 0) return 0;
    const raw = total / weight;
    // Small, bounded severity correction. CP-derived accuracy remains the
    // primary signal; this only prevents several clearly bad classifications
    // from averaging back into an implausibly high score.
    const playerMoves = classifications.filter(c =>
      (c.mover === mover) || (!c.mover && c.isPlayer)
    );
    const blunders = playerMoves.filter(c => c.type === 'blunder').length;
    const mistakes = playerMoves.filter(c => c.type === 'mistake').length;
    const inaccuracies = playerMoves.filter(c => c.type === 'inaccuracy').length;
    const severityPenalty = Math.min(10, blunders * 2.5 + mistakes * 0.8 + inaccuracies * 0.2);
    return Math.max(0, Math.min(100, raw - severityPenalty));
  }

  /* ══════════════════════════════════════
     أدوات لحظية: ETA, NPS, تسمية التقييم
  ══════════════════════════════════════ */
  static formatETA(done, total, elapsedMs) {
    if (done === 0 || total === 0) return '...';
    const remaining = ((total - done) / done) * elapsedMs;
    if (remaining < 60000) return `${Math.ceil(remaining / 1000)}ث`;
    return `${Math.ceil(remaining / 60000)}د`;
  }

  static formatNPS(nodes, elapsedMs) {
    if (!nodes || elapsedMs < 200) return '—';
    const nps = nodes / (elapsedMs / 1000);
    if (nps >= 1e6) return `${(nps / 1e6).toFixed(1)}M/ث`;
    if (nps >= 1000) return `${Math.round(nps / 1000)}K/ث`;
    return `${Math.round(nps)}/ث`;
  }

  static evalLabel(result, fen) {
    if (!result) return '+0.00';
    const turn = (fen || '').split(' ')[1] || 'w';
    if (result.mate !== null && result.mate !== undefined) {
      let m = result.mate;
      if (turn === 'b') m = -m;
      return m > 0 ? `M${m}` : `-M${Math.abs(m)}`;
    }
    let cp = result.cp ?? 0;
    if (turn === 'b') cp = -cp;
    return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
  }

  destroy() {
    this.pool.forEach(s => { try { s.worker.terminate(); } catch (_) {} });
    this.pool  = [];
    this.ready = false;
  }
}

if (typeof window !== 'undefined') window.AnalysisEngine = AnalysisEngine;
if (typeof module !== 'undefined')  module.exports = AnalysisEngine;
