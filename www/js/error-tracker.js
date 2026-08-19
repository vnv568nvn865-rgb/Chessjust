/**
 * ErrorTracker - متعقب أخطاء اللاعب
 * يحفظ أنماط الأخطاء عبر المباريات ويحولها إلى نقاط تدريب
 * يستخدم localStorage للاستمرارية بين الجلسات
 */

class ErrorTracker {
  constructor(playerName) {
    this.playerName = playerName || 'player';
    this.storageKey = `chessjust_errors_${this.playerName}`;
    this.data = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {
      gamesCount: 0,
      totalMoves: 0,
      patterns: {},
      gamesHistory: [],
      lastUpdated: null
    };
  }

  _save() {
    try {
      this.data.lastUpdated = new Date().toISOString();
      localStorage.setItem(this.storageKey, JSON.stringify(this.data));
    } catch (e) { /* ignore */ }
  }

  // تسجيل تحليل مباراة
  recordGame(gameId, movesAnalysis, accuracy) {
    const gamePatterns = {};
    let blunders = 0, mistakes = 0, inaccuracies = 0;

    for (const m of movesAnalysis) {
      if (!m.isPlayerMove) continue;
      const cls = m.classification || AnalysisEngine.classifyMove(m.cpLoss || 0);
      if (cls.type === 'blunder') blunders++;
      else if (cls.type === 'mistake') mistakes++;
      else if (cls.type === 'inaccuracy') inaccuracies++;

      for (const p of (m.tactical || [])) {
        gamePatterns[p] = (gamePatterns[p] || 0) + 1;
        this.data.patterns[p] = this.data.patterns[p] || { count: 0, recent: [] };
        this.data.patterns[p].count++;
        this.data.patterns[p].recent.push({
          gameId, moveNumber: m.moveNumber, move: m.move, date: new Date().toISOString()
        });
        // الاحتفاظ بآخر 20 مثال فقط
        if (this.data.patterns[p].recent.length > 20) {
          this.data.patterns[p].recent.shift();
        }
      }
    }

    this.data.gamesCount++;
    this.data.totalMoves += movesAnalysis.filter(m => m.isPlayerMove).length;
    this.data.gamesHistory.push({
      gameId,
      accuracy,
      blunders,
      mistakes,
      inaccuracies,
      date: new Date().toISOString(),
      patterns: gamePatterns
    });

    // الاحتفاظ بآخر 50 مباراة فقط
    if (this.data.gamesHistory.length > 50) {
      this.data.gamesHistory.shift();
    }

    this._save();
  }

  // الحصول على أهم أنماط الأخطاء مرتبة بالتكرار
  getTopPatterns(limit = 5) {
    const coach = new ChessCoach();
    return Object.entries(this.data.patterns)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, limit)
      .map(([pattern, data]) => ({
        pattern,
        nameAr: coach.ERROR_PATTERNS[pattern]?.nameAr || pattern,
        count: data.count,
        perGame: this.data.gamesCount > 0 ? (data.count / this.data.gamesCount).toFixed(1) : 0,
        recentExamples: data.recent.slice(-3),
        trainingTip: coach._getTrainingTip(pattern),
        severity: data.count > 5 ? 'high' : data.count > 2 ? 'medium' : 'low'
      }));
  }

  // مؤشرات الأداء العامة
  getPerformanceStats() {
    const recent = this.data.gamesHistory.slice(-10);
    if (recent.length === 0) return null;

    const avgAccuracy = Math.round(recent.reduce((s, g) => s + (g.accuracy || 0), 0) / recent.length);
    const avgBlunders = (recent.reduce((s, g) => s + g.blunders, 0) / recent.length).toFixed(1);
    const trend = this._calculateTrend(recent.map(g => g.accuracy));

    return {
      gamesAnalyzed: this.data.gamesCount,
      recentGames: recent.length,
      avgAccuracy,
      avgBlunders,
      trend,
      trendText: trend > 2 ? '📈 تحسن ملحوظ' : trend < -2 ? '📉 تراجع - راجع أخطاءك' : '➡️ مستوى ثابت'
    };
  }

  _calculateTrend(values) {
    if (values.length < 3) return 0;
    const first = values.slice(0, Math.floor(values.length / 2));
    const last = values.slice(Math.ceil(values.length / 2));
    const avgFirst = first.reduce((s, v) => s + v, 0) / first.length;
    const avgLast = last.reduce((s, v) => s + v, 0) / last.length;
    return Math.round(avgLast - avgFirst);
  }

  // توليد خطة تدريب بناءً على الأخطاء
  generateTrainingPlan() {
    const patterns = this.getTopPatterns(3);
    if (patterns.length === 0) {
      return ['العب المزيد من المباريات لأتمكن من تحديد نقاط الضعف لديك'];
    }

    const plan = [];
    for (const p of patterns) {
      plan.push({
        area: p.nameAr,
        frequency: `${p.perGame} مرة/مباراة`,
        priority: p.severity === 'high' ? '🔴 عالية' : p.severity === 'medium' ? '🟡 متوسطة' : '🟢 منخفضة',
        action: p.trainingTip
      });
    }
    return plan;
  }

  // مسح البيانات
  clear() {
    this.data = { gamesCount: 0, totalMoves: 0, patterns: {}, gamesHistory: [], lastUpdated: null };
    try { localStorage.removeItem(this.storageKey); } catch (e) { /* ignore */ }
  }
}

if (typeof window !== 'undefined') window.ErrorTracker = ErrorTracker;
if (typeof module !== 'undefined') module.exports = ErrorTracker;
