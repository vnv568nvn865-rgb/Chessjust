/**
 * AnalysisEngine v4 — Chessjust
 *
 * نظام موحّد للتحليل:
 * Stockfish CP -> تقييم من منظور الأبيض -> CP Loss من منظور صاحب النقلة
 * -> Accuracy + Classification.
 * لا يعتمد على WDL ولا على fallback رقمي مصطنع.
 */
class AnalysisEngine {
  constructor(options = {}) {
    this.stockfishPath = options.stockfishPath || './vendor/stockfish-18-single.js';
    this.poolSize = Math.min(Math.max(options.poolSize || 2, 1), 3);
    this.pool = [];
    this.ready = false;
    this._loading = false;
    this.LEVELS = {
      ULTRA:  { id:'ULTRA', icon:'⚡', nameAr:'خفيف',   nodes:50000,   estSec:2,   descAr:'~2ث / 70 نقلة' },
      FAST:   { id:'FAST',  icon:'🏃', nameAr:'سريع',   nodes:150000,  estSec:5,   descAr:'~5ث / 70 نقلة' },
      MEDIUM: { id:'MEDIUM',icon:'⚖️', nameAr:'متوازن', nodes:500000,  estSec:14,  descAr:'~14ث / 70 نقلة' },
      DEEP:   { id:'DEEP',  icon:'🔬', nameAr:'عميق',   nodes:1500000, estSec:40,  descAr:'~40ث / 70 نقلة' },
      FULL:   { id:'FULL',  icon:'💎', nameAr:'كامل',   nodes:5000000, estSec:130, descAr:'~2د — للمباريات المهمة' },
      CUSTOM: { id:'CUSTOM',icon:'🎛️', nameAr:'مخصص',  nodes:500000,  estSec:null, descAr:'nodes مخصص' }
    };
    this.currentLevel = 'MEDIUM';
    this.customNodes = 500000;
  }

  async initialize() {
    if (this.ready) return;
    if (this._loading) {
      while (this._loading) await new Promise(r => setTimeout(r, 25));
      if (!this.ready) throw new Error('تعذر تهيئة المحرك');
      return;
    }
    this._loading = true;
    const errors = [];
    try {
      for (let i = 0; i < this.poolSize; i++) {
        try { this.pool.push(await this._createSlot()); }
        catch (e) { errors.push(e); }
      }
      if (!this.pool.length) throw (errors[0] || new Error('تعذر تشغيل Stockfish'));
      this.ready = true;
    } finally { this._loading = false; }
  }

  _createSlot() {
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = new Worker(this.stockfishPath); }
      catch (e) { reject(e); return; }

      const slot = { worker, busy:false, pendingResolve:null, pendingInfo:null, onInfo:null, pendingReadyResolve:null };
      let settled = false, uciOk = false, readyOk = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        this._attachHandler(slot);
        resolve(slot);
      };
      const fail = e => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        try { worker.terminate(); } catch (_) {}
        reject(e instanceof Error ? e : new Error('Stockfish worker error'));
      };

      const hardTimer = setTimeout(() => {
        // Some Stockfish JS builds do not expose the handshake lines reliably
        // through every Android WebView. The original project tolerated this
        // after a short load window, so do the same rather than blocking Coach.
        if (uciOk || readyOk) finish();
        else finish();
      }, 2500);

      worker.onerror = fail;
      worker.onmessage = e => {
        const line = typeof e.data === 'string' ? e.data.trim() : '';
        if (!line) return;
        if (line === 'uciok') uciOk = true;
        if (line === 'readyok') readyOk = true;
        if (uciOk && readyOk) finish();
      };

      try {
        worker.postMessage('uci');
        worker.postMessage('isready');
      } catch (e) { fail(e); }
    });
  }

  _attachHandler(slot) {
    slot.worker.onmessage = e => {
      const line = typeof e.data === 'string' ? e.data.trim() : '';
      if (!line) return;
      const cpM = line.match(/\bscore cp (-?\d+)/);
      const mateM = line.match(/\bscore mate (-?\d+)/);
      const depM = line.match(/\bdepth (\d+)/);
      const nodM = line.match(/\bnodes (\d+)/);
      const timM = line.match(/\btime (\d+)/);
      const pvM = line.match(/\bpv (.+)/);
      if (cpM || mateM || depM || nodM || timM || pvM) {
        const prev = slot.pendingInfo || {};
        slot.pendingInfo = {
          cp: cpM ? parseInt(cpM[1],10) : (prev.cp ?? null),
          mate: mateM ? parseInt(mateM[1],10) : (prev.mate ?? null),
          depth: depM ? parseInt(depM[1],10) : (prev.depth || 0),
          nodes: nodM ? parseInt(nodM[1],10) : (prev.nodes || 0),
          time: timM ? parseInt(timM[1],10) : (prev.time || 0),
          pv: pvM ? pvM[1].trim().split(/\s+/) : (prev.pv || [])
        };
        if (typeof slot.onInfo === 'function') slot.onInfo({...slot.pendingInfo});
      }
      if (line === 'readyok' && slot.pendingReadyResolve) {
        const rr = slot.pendingReadyResolve;
        slot.pendingReadyResolve = null;
        rr(true);
      }
      if (line.startsWith('bestmove')) {
        const bm = line.split(/\s+/)[1];
        const result = {...(slot.pendingInfo || {}), bestmove:(bm && bm !== '(none)') ? bm : null, valid:true};
        slot.pendingInfo = null;
        if (slot.pendingResolve) {
          const cb = slot.pendingResolve;
          slot.pendingResolve = null;
          cb(result);
        }
      }
    };
    slot.worker.onerror = () => {
      if (slot.pendingResolve) {
        const cb = slot.pendingResolve;
        slot.pendingResolve = null;
        cb(AnalysisEngine.emptyResult());
      }
    };
  }

  static emptyResult() { return {cp:null,mate:null,bestmove:null,depth:0,nodes:0,time:0,pv:[],valid:false}; }

  async _waitReady(slot, timeoutMs = 3000) {
    return new Promise(resolve => {
      let done = false;
      const finish = ok => { if (done) return; done = true; clearTimeout(timer); slot.pendingReadyResolve = null; resolve(ok); };
      const timer = setTimeout(() => finish(false), timeoutMs);
      slot.pendingReadyResolve = () => finish(true);
      try {
        slot.worker.postMessage('stop');
        slot.worker.postMessage('isready');
      } catch (_) { finish(false); }
    });
  }

  async _querySlot(slot, fen, nodes, onInfo) {
    // تأكد من أن العامل خرج من أي بحث سابق قبل إرسال position/go.
    const ready = await this._waitReady(slot, 3000);
    if (!ready) return AnalysisEngine.emptyResult();
    const timeoutMs = Math.max(30000, Math.ceil(nodes / 50000) * 4000);
    return new Promise(resolve => {
      let settled = false, timer = null;
      const settle = r => { if (settled) return; settled = true; clearTimeout(timer); slot.onInfo = null; slot.pendingResolve = null; resolve(r); };
      slot.pendingInfo = null;
      slot.onInfo = info => { if (typeof onInfo === 'function') onInfo(info); };
      slot.pendingResolve = settle;
      timer = setTimeout(() => {
        try { slot.worker.postMessage('stop'); } catch (_) {}
        setTimeout(() => settle(AnalysisEngine.emptyResult()), 2500);
      }, timeoutMs);
      try {
        slot.worker.postMessage('ucinewgame');
        slot.worker.postMessage('position fen ' + fen);
        slot.worker.postMessage('go nodes ' + nodes);
      } catch (_) { settle(AnalysisEngine.emptyResult()); }
    });
  }

  async queryPosition(fen, overrideNodes, onInfo) {
    if (!this.ready) throw new Error('المحرك غير جاهز');
    const slot = await this._waitForFreeSlot();
    slot.busy = true;
    try { return await this._querySlot(slot, fen, overrideNodes || this._getNodes(), onInfo); }
    finally { slot.busy = false; }
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

  async analyzeBulk(fens, overrideNodes, onEach, onProgress) {
    if (!this.ready) throw new Error('المحرك غير جاهز');
    if (!Array.isArray(fens) || !fens.length) return [];
    const nodes = overrideNodes || this._getNodes();
    const results = new Array(fens.length).fill(null);
    let nextIdx = 0;
    const run = async slot => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= fens.length) break;
        slot.busy = true;
        try {
          const r = await this._querySlot(slot, fens[idx], nodes, info => {
            if (typeof onProgress === 'function') onProgress(idx, info);
          });
          results[idx] = r;
          if (typeof onEach === 'function') onEach(idx, r);
        } finally { slot.busy = false; }
      }
    };
    await Promise.all(this.pool.map(run));
    return results;
  }

  _getNodes() { return this.currentLevel === 'CUSTOM' ? Math.max(10000,this.customNodes) : (this.LEVELS[this.currentLevel]?.nodes || 500000); }
  setLevel(id) { if (this.LEVELS[id]) this.currentLevel = id; }
  setCustomNodes(n) { this.customNodes = Math.max(10000, n); this.currentLevel = 'CUSTOM'; }
  getLevel() { return this.LEVELS[this.currentLevel]; }
  getAllLevels() { return Object.values(this.LEVELS); }
  estimateSeconds(numMoves) { const lv=this.LEVELS[this.currentLevel]; return lv?.estSec ? Math.ceil(lv.estSec*numMoves/70) : null; }

  static mateToWhiteCp(mate, turn) {
    if (typeof mate !== 'number' || !Number.isFinite(mate)) return null;
    const d = Math.abs(mate);
    const cp = Math.max(10000 - d * 50, 1000);
    const sideCp = mate > 0 ? cp : -cp;
    return turn === 'b' ? -sideCp : sideCp;
  }

  static resultToWhiteCp(result, fen) {
    if (!result) return null;
    if (typeof result.whiteCp === 'number' && Number.isFinite(result.whiteCp)) return result.whiteCp;
    const turn = (fen || '').split(/\s+/)[1] || 'w';
    if (result.mate !== null && result.mate !== undefined) return AnalysisEngine.mateToWhiteCp(result.mate, turn);
    if (typeof result.cp !== 'number' || !Number.isFinite(result.cp)) return null;
    const cp = Math.max(-10000, Math.min(10000, result.cp));
    return turn === 'b' ? -cp : cp;
  }

  static resultToMoverCp(result) {
    if (!result) return null;
    if (result.mate !== null && result.mate !== undefined) return AnalysisEngine.mateToMoverCp(result.mate);
    return typeof result.cp === 'number' && Number.isFinite(result.cp) ? Math.max(-10000,Math.min(10000,result.cp)) : null;
  }

  static mateToMoverCp(mate) {
    if (typeof mate !== 'number' || !Number.isFinite(mate)) return null;
    const d = Math.abs(mate);
    const cp = Math.max(10000 - d * 50, 1000);
    return mate > 0 ? cp : -cp;
  }

  static expectedScore(cp) {
    if (typeof cp !== 'number' || !Number.isFinite(cp)) return null;
    const c = Math.max(-1000, Math.min(1000, cp));
    return 50 + 50 * (2/(1 + Math.exp(-0.00368208*c)) - 1);
  }
  static cpToWinPct(cp) { return AnalysisEngine.expectedScore(cp); }

  static cpLossFromWhiteCp(beforeWhite, afterWhite, mover) {
    if (typeof beforeWhite !== 'number' || typeof afterWhite !== 'number') return null;
    return Math.max(0, mover === 'w' ? beforeWhite - afterWhite : afterWhite - beforeWhite);
  }

  static moveAccuracy(cpLoss, beforeWhiteCp, afterWhiteCp) {
    if (typeof cpLoss !== 'number' || typeof beforeWhiteCp !== 'number' || typeof afterWhiteCp !== 'number') return null;
    const before = AnalysisEngine.expectedScore(beforeWhiteCp);
    const after = AnalysisEngine.expectedScore(afterWhiteCp);
    if (before === null || after === null) return null;
    const impactPct = Math.max(0, before - after);
    // before/after are percentage points (0..100). Keep tiny evaluation
    // changes near 100%, while meaningful losses fall quickly.
    const accuracy = 100 * Math.exp(-0.035 * Math.pow(impactPct, 0.80));
    return Math.max(0, Math.min(100, accuracy));
  }

  static _boardFromFen(fen) {
    const board = {};
    if (!fen) return board;
    let rank = 8, file = 0;
    for (const ch of fen.split(' ')[0]) {
      if (ch === '/') { rank--; file = 0; continue; }
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      board[String.fromCharCode(97 + file) + rank] = ch;
      file++;
    }
    return board;
  }

  static isImmediateSacrifice(verboseMove, nextVerboseMove, fenAfter) {
    if (!verboseMove || !nextVerboseMove) return false;
    const movedValue = {p:1,n:3.25,b:3.4,r:5,q:9,k:0}[String(verboseMove.piece||'').toLowerCase()] || 0;
    const nextCapture = String(nextVerboseMove.captured || '').toLowerCase();
    const recapturesDestination = nextVerboseMove.to === verboseMove.to;
    if (!nextCapture || !recapturesDestination || movedValue < 3) return false;
    const afterBoard = AnalysisEngine._boardFromFen(fenAfter);
    const pieceThere = afterBoard[verboseMove.to];
    const moverColor = String(verboseMove.color || '').toLowerCase();
    const pieceIsStillThere = pieceThere && ((moverColor === 'w' && pieceThere === pieceThere.toUpperCase()) || (moverColor === 'b' && pieceThere === pieceThere.toLowerCase()));
    return !pieceIsStillThere;
  }

  static classifyMove({beforeResult, afterResult, mover, playedUci, bestUci, verboseMove, nextVerboseMove, fenBefore, fenAfter}) {
    const beforeWhiteCp = AnalysisEngine.resultToWhiteCp(beforeResult, fenBefore);
    const afterWhiteCp = AnalysisEngine.resultToWhiteCp(afterResult, fenAfter);
    if (beforeWhiteCp === null || afterWhiteCp === null || !playedUci) {
      return {type:'unrated',labelAr:'غير متاحة',symbol:'—',cpLoss:null,moveAcc:null,missedOpportunity:false,color:AnalysisEngine.colors().unrated,bg:AnalysisEngine.colors().unrated+'22',mover,isBest:false};
    }
    const cpLoss = AnalysisEngine.cpLossFromWhiteCp(beforeWhiteCp, afterWhiteCp, mover);
    const isBest = !!(bestUci && bestUci !== '(none)' && playedUci === bestUci);
    const sacrifice = AnalysisEngine.isImmediateSacrifice(verboseMove, nextVerboseMove, fenAfter);
    const brilliant = sacrifice && isBest && cpLoss <= 15;
    const great = !isBest && !brilliant && cpLoss > 0 && cpLoss <= 12;
    const missedOpportunity = beforeWhiteCp >= 150 && cpLoss >= 80 && !isBest;
    let type='excellent', labelAr='ممتازة', symbol='';
    if (brilliant) { type='brilliant'; labelAr='رائعة'; symbol='‼'; }
    else if (isBest) { type='best'; labelAr='أفضل نقلة'; symbol='★'; }
    else if (great) { type='great'; labelAr='مدهشة'; symbol='!'; }
    else if (cpLoss <= 30) { type='excellent'; labelAr='ممتازة'; }
    else if (cpLoss <= 60) { type='good'; labelAr='جيدة'; }
    else if (cpLoss <= 100) { type='inaccuracy'; labelAr='غير دقيقة'; symbol='?!'; }
    else if (cpLoss <= 200) { type='mistake'; labelAr='خطأ'; symbol='?'; }
    else { type='blunder'; labelAr='خطأ فادح'; symbol='??'; }
    if (missedOpportunity && (type === 'mistake' || type === 'inaccuracy')) { labelAr='تضييع فرصة'; symbol='⚡'; }
    const color = AnalysisEngine.colors()[type] || AnalysisEngine.colors().excellent;
    return {
      type,labelAr,symbol,cpLoss,loss:cpLoss,
      moveAcc:AnalysisEngine.moveAccuracy(cpLoss,beforeWhiteCp,afterWhiteCp),
      missedOpportunity,color,bg:color+'22',mover,
      beforeCp:beforeWhiteCp,afterCp:afterWhiteCp,isBest,bestmove:bestUci||null,
      sacrifice
    };
  }

  // Backward-compatible wrapper for any old caller.
  static classifyLegacy(beforeResult, afterResult, mover, playedUci, bestUci, verboseMove, nextVerboseMove, fenBefore, fenAfter) {
    return AnalysisEngine.classifyMove({beforeResult,afterResult,mover,playedUci,bestUci,verboseMove,nextVerboseMove,fenBefore,fenAfter});
  }

  static colors() { return {brilliant:'#37c6e0',best:'#5f9e6e',great:'#7fb87a',excellent:'#9fc98a',good:'#b5d4a0',inaccuracy:'#d9b64e',mistake:'#d98a3f',blunder:'#c95a4a',unrated:'#8c8175'}; }

  static gameAccuracy(classifications, mover) {
    const vals = (classifications || []).filter(c => c && c.mover === mover && typeof c.moveAcc === 'number').map(c => c.moveAcc);
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
  }
  static formatETA(done,total,elapsedMs) { if(!done||!total) return '...'; const rem=((total-done)/done)*elapsedMs; return rem<60000?`${Math.ceil(rem/1000)}ث`:`${Math.ceil(rem/60000)}د`; }
  static formatNPS(nodes,elapsedMs) { if(!nodes||elapsedMs<200) return '—'; const nps=nodes/(elapsedMs/1000); return nps>=1e6?`${(nps/1e6).toFixed(1)}M/ث`:nps>=1000?`${Math.round(nps/1000)}K/ث`:`${Math.round(nps)}/ث`; }
  static evalLabel(result,fen) {
    if(!result) return '—';
    const turn=(fen||'').split(/\s+/)[1]||'w';
    if(result.mate!==null&&result.mate!==undefined){const cp=AnalysisEngine.mateToWhiteCp(result.mate,turn);return cp>=0?`+M${Math.abs(result.mate)}`:`-M${Math.abs(result.mate)}`;}
    const cp=AnalysisEngine.resultToWhiteCp(result,fen); if(cp===null)return '—'; return (cp>=0?'+':'')+(cp/100).toFixed(2);
  }

  destroy(){ this.pool.forEach(s=>{try{s.worker.terminate();}catch(_){}}); this.pool=[]; this.ready=false; }
}
if(typeof window!=='undefined') window.AnalysisEngine=AnalysisEngine;
if(typeof module!=='undefined') module.exports=AnalysisEngine;
