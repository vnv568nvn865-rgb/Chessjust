/**
 * AnalysisEngine v3 — Chessjust
 *
 * نظام التقييم الجديد:
 * - CP (centipawn) هو المصدر الوحيد للدقة والتصنيف.
 * - لا يعتمد على الاحتمالات القديمة ولا يضع قيمة افتراضية 50% عند فشل المحرك.
 * - ينتظر uciok/readyok الحقيقيين قبل إعلان المحرك جاهزاً.
 * - يحافظ على مستويات التحليل وPool المتوازي.
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
      MEDIUM: { id:'MEDIUM',icon:'⚖️', nameAr:'متوازن', nodes:500000,  estSec:14,  descAr:'~14ث / 70 نقلة (افتراضي)' },
      DEEP:   { id:'DEEP',  icon:'🔬', nameAr:'عميق',   nodes:1500000, estSec:40,  descAr:'~40ث / 70 نقلة' },
      FULL:   { id:'FULL',  icon:'💎', nameAr:'كامل',   nodes:5000000, estSec:130, descAr:'~2د — للمباريات المهمة' },
      CUSTOM: { id:'CUSTOM',icon:'🎛️', nameAr:'مخصص',  nodes:500000,  estSec:null,descAr:'nodes مخصص' }
    };
    this.currentLevel='MEDIUM';
    this.customNodes=500000;
  }

  async initialize() {
    if (this.ready) return;
    if (this._loading) {
      while (this._loading) await new Promise(r=>setTimeout(r,25));
      if (!this.ready) throw new Error('تعذر تهيئة المحرك');
      return;
    }
    this._loading=true;
    const errors=[];
    try {
      for (let i=0;i<this.poolSize;i++) {
        try { this.pool.push(await this._createSlot()); }
        catch(e){ errors.push(e); }
      }
      if (!this.pool.length) throw (errors[0] || new Error('تعذر تشغيل Stockfish'));
      this.ready=true;
    } finally { this._loading=false; }
  }

  _createSlot() {
    return new Promise((resolve,reject)=>{
      let worker;
      try { worker=new Worker(this.stockfishPath); }
      catch(e){ reject(e); return; }
      let settled=false;
      let uciOk=false;
      let readyOk=false;
      const slot={worker,busy:false,pendingResolve:null,pendingInfo:null};
      const fail=(e)=>{
        if(settled) return;
        settled=true;
        try{worker.terminate();}catch(_){ }
        reject(e instanceof Error?e:new Error('Stockfish worker error'));
      };
      const timer=setTimeout(()=>fail(new Error('Stockfish لم يرسل readyok')),12000);
      worker.onerror=fail;
      worker.onmessage=(e)=>{
        const line=typeof e.data==='string'?e.data:'';
        if(!line) return;
        if(line==='uciok') uciOk=true;
        if(line==='readyok') readyOk=true;
        if(uciOk && readyOk && !settled){
          settled=true;
          clearTimeout(timer);
          this._attachHandler(slot);
          resolve(slot);
        }
      };
      worker.postMessage('uci');
      // لا نطلب الاحتمالات القديمة: CP هو النظام الوحيد.
      worker.postMessage('isready');
    });
  }

  _attachHandler(slot) {
    slot.worker.onmessage=(e)=>{
      const line=typeof e.data==='string'?e.data:'';
      if(!line) return;
      const cpM=line.match(/\bscore cp (-?\d+)/);
      const mateM=line.match(/\bscore mate (-?\d+)/);
      const depM=line.match(/\bdepth (\d+)/);
      const nodM=line.match(/\bnodes (\d+)/);
      const timM=line.match(/\btime (\d+)/);
      const pvM=line.match(/\bpv (.+)/);
      if(cpM || mateM || depM || nodM || timM || pvM){
        const prev=slot.pendingInfo || {};
        slot.pendingInfo={
          cp: cpM ? parseInt(cpM[1],10) : (prev.cp ?? null),
          mate: mateM ? parseInt(mateM[1],10) : (prev.mate ?? null),
          depth: depM ? parseInt(depM[1],10) : (prev.depth || 0),
          nodes: nodM ? parseInt(nodM[1],10) : (prev.nodes || 0),
          time: timM ? parseInt(timM[1],10) : (prev.time || 0),
          pv: pvM ? pvM[1].trim().split(/\s+/) : (prev.pv || [])
        };
      }
      if(line.startsWith('bestmove')){
        const bm=line.split(/\s+/)[1];
        const result={...(slot.pendingInfo||{}),bestmove:(bm && bm!=='(none)')?bm:null};
        slot.pendingInfo=null;
        if(slot.pendingResolve){const cb=slot.pendingResolve;slot.pendingResolve=null;cb(result);}
      }
    };
    slot.worker.onerror=()=>{
      if(slot.pendingResolve){const cb=slot.pendingResolve;slot.pendingResolve=null;cb(AnalysisEngine.emptyResult());}
    };
  }

  static emptyResult(){return {cp:null,mate:null,bestmove:null,depth:0,nodes:0,time:0,pv:[]};}

  _querySlot(slot,fen,nodes){
    const timeoutMs=Math.max(30000,Math.ceil(nodes/50000)*3000);
    return new Promise(resolve=>{
      let settled=false;
      let timer=null;
      const settle=(r)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(r);};
      slot.pendingInfo=null;
      slot.pendingResolve=settle;
      timer=setTimeout(()=>{
        try{slot.worker.postMessage('stop');}catch(_){ }
        setTimeout(()=>settle(AnalysisEngine.emptyResult()),2000);
      },timeoutMs);
      try{
        slot.worker.postMessage('ucinewgame');
        slot.worker.postMessage('position fen '+fen);
        slot.worker.postMessage('go nodes '+nodes);
      }catch(_){settle(AnalysisEngine.emptyResult());}
    });
  }

  async queryPosition(fen,overrideNodes){
    if(!this.ready) throw new Error('المحرك غير جاهز');
    const slot=await this._waitForFreeSlot(); slot.busy=true;
    try{return await this._querySlot(slot,fen,overrideNodes||this._getNodes());}
    finally{slot.busy=false;}
  }

  async _waitForFreeSlot(){
    const free=this.pool.find(s=>!s.busy); if(free)return free;
    return new Promise(resolve=>{
      const iv=setInterval(()=>{const f=this.pool.find(s=>!s.busy);if(f){clearInterval(iv);resolve(f);}},40);
    });
  }

  async analyzeBulk(fens,overrideNodes,onEach){
    if(!this.ready) throw new Error('المحرك غير جاهز');
    const nodes=overrideNodes||this._getNodes();
    const results=new Array(fens.length).fill(null);
    let nextIdx=0;
    const run=async(slot)=>{
      while(true){
        const idx=nextIdx++;
        if(idx>=fens.length) break;
        slot.busy=true;
        try{
          const r=await this._querySlot(slot,fens[idx],nodes);
          results[idx]=r;
          if(onEach) onEach(idx,r);
        }finally{slot.busy=false;}
      }
    };
    await Promise.all(this.pool.map(run));
    return results;
  }

  _getNodes(){return this.currentLevel==='CUSTOM'?Math.max(10000,this.customNodes):(this.LEVELS[this.currentLevel]?.nodes||500000);}
  setLevel(id){if(this.LEVELS[id])this.currentLevel=id;}
  setCustomNodes(n){this.customNodes=Math.max(10000,n);this.currentLevel='CUSTOM';}
  getLevel(){return this.LEVELS[this.currentLevel];}
  getAllLevels(){return Object.values(this.LEVELS);}
  estimateSeconds(numMoves){const lv=this.LEVELS[this.currentLevel];return lv?.estSec?Math.ceil(lv.estSec*numMoves/70):null;}

  static mateToCp(mate){
    if(typeof mate!=='number'||!Number.isFinite(mate))return null;
    const d=Math.abs(mate);
    return mate>0?Math.max(1000,10000-d*50):-Math.max(1000,10000-d*50);
  }
  static resultToMoverCp(result){
    if(!result)return null;
    if(result.mate!==null&&result.mate!==undefined)return AnalysisEngine.mateToCp(result.mate);
    return typeof result.cp==='number'&&Number.isFinite(result.cp)?Math.max(-10000,Math.min(10000,result.cp)):null;
  }
  static resultToWhiteCp(result,fen){
    const cp=AnalysisEngine.resultToMoverCp(result); if(cp===null)return null;
    const turn=(fen||'').split(/\s+/)[1]||'w';
    return turn==='b'?-cp:cp;
  }
  static cpToWinPct(cp){
    if(typeof cp!=='number'||!Number.isFinite(cp))return null;
    const c=Math.max(-1000,Math.min(1000,cp));
    return 50+50*(2/(1+Math.exp(-0.00368208*c))-1);
  }
  static resultToWhiteWinPct(result,fen){
    const cp=AnalysisEngine.resultToWhiteCp(result,fen);
    return cp===null?null:AnalysisEngine.cpToWinPct(cp);
  }
  static cpLossFromResults(before,after,mover){
    const b=AnalysisEngine.resultToMoverCp(before), a=AnalysisEngine.resultToMoverCp(after);
    if(b===null||a===null)return null;
    return Math.max(0,b-a);
  }
  static cpLossFromWhiteCp(beforeWhite,afterWhite,mover){
    if(typeof beforeWhite!=='number'||typeof afterWhite!=='number')return null;
    return Math.max(0,mover==='w'?beforeWhite-afterWhite:afterWhite-beforeWhite);
  }
  static cpImpactLoss(cpLoss,beforeCp,afterCp){
    if(typeof cpLoss!=='number')return null;
    const b=typeof beforeCp==='number'?Math.max(-1000,Math.min(1000,beforeCp)):0;
    const a=typeof afterCp==='number'?Math.max(-1000,Math.min(1000,afterCp)):b;
    const wb=AnalysisEngine.cpToWinPct(b), wa=AnalysisEngine.cpToWinPct(a);
    if(wb===null||wa===null)return Math.min(100,cpLoss/10);
    return Math.max(0,wb-wa);
  }
  static moveAccuracy(cpLoss,beforeCp,afterCp){
    if(cpLoss===null)return null;
    const b=typeof beforeCp==='number'?Math.max(-1000,Math.min(1000,beforeCp)):0;
    const a=typeof afterCp==='number'?Math.max(-1000,Math.min(1000,afterCp)):b;
    const wb=AnalysisEngine.cpToWinPct(b), wa=AnalysisEngine.cpToWinPct(a);
    const impact=Math.max(0,wb-wa);
    return Math.max(0,Math.min(100,103.1668*Math.exp(-0.04354*impact)-3.1669));
  }

  static classifyMove(a,b,c,d,e,f,g,h){
    // دعم الاستدعاء القديم classifyMove(cpLoss) من الأدوات الأخرى.
    if(arguments.length===1 && typeof a==='number'){
      const loss=Math.max(0,a);
      let type='excellent',labelAr='ممتازة',symbol='';
      if(loss<=10){type=loss===0?'best':'great';labelAr=loss===0?'أفضل نقلة':'مدهشة';symbol=loss===0?'★':'!';}
      else if(loss<=25){type='excellent';labelAr='ممتازة';}
      else if(loss<=50){type='good';labelAr='جيدة';}
      else if(loss<=100){type='inaccuracy';labelAr='غير دقيقة';symbol='?!';}
      else if(loss<=200){type='mistake';labelAr='خطأ';symbol='?';}
      else {type='blunder';labelAr='خطأ فادح';symbol='??';}
      return {type,labelAr,symbol,loss,cpLoss:loss,moveAcc:AnalysisEngine.moveAccuracy(loss,0,-loss),missedOpportunity:false,color:AnalysisEngine.colors()[type]||'#9fc98a',bg:(AnalysisEngine.colors()[type]||'#9fc98a')+'22',mover:null};
    }
    const beforeResult=a, afterResult=b, mover=c, playedUci=d, bestUci=e, verboseMv=f;
    const beforeCp=AnalysisEngine.resultToMoverCp(beforeResult);
    const afterMoverCp=AnalysisEngine.resultToMoverCp(afterResult);
    if(beforeCp===null||afterMoverCp===null||!playedUci){
      return {type:'unrated',labelAr:'غير متاحة',symbol:'—',loss:null,cpLoss:null,moveAcc:null,missedOpportunity:false,color:'#8c8175',bg:'#8c817522',mover};
    }
    const cpLoss=Math.max(0,beforeCp-afterMoverCp);
    const isBest=!!(bestUci&&bestUci!=='null'&&bestUci!=='(none)'&&playedUci===bestUci);
    const PV={p:1,n:3,b:3,r:5,q:9,k:0};
    const sacrifice=!!(verboseMv?.captured && PV[verboseMv.piece] < PV[verboseMv.captured]);
    const brilliant=isBest && sacrifice && cpLoss<=15 && beforeCp>-500 && beforeCp<900;
    // Great is deliberately narrower than Excellent and cannot be awarded to a best move.
    const great=!isBest && cpLoss>0 && cpLoss<=8 && Math.abs(beforeCp)<=500;
    const missedOpportunity=beforeCp>=150 && cpLoss>=80 && !isBest;
    let type,labelAr,symbol;
    if(brilliant){type='brilliant';labelAr='رائعة';symbol='‼';}
    else if(isBest){type='best';labelAr='أفضل نقلة';symbol='★';}
    else if(great){type='great';labelAr='مدهشة';symbol='!';}
    else if(cpLoss<=25){type='excellent';labelAr='ممتازة';symbol='';}
    else if(cpLoss<=50){type='good';labelAr='جيدة';symbol='';}
    else if(cpLoss<=100){type='inaccuracy';labelAr='غير دقيقة';symbol='?!';}
    else if(cpLoss<=200){type='mistake';labelAr='خطأ';symbol='?';}
    else {type='blunder';labelAr='خطأ فادح';symbol='??';}
    if(missedOpportunity && (type==='mistake'||type==='inaccuracy')){labelAr='تضييع فرصة';symbol='⚡';}
    const color=AnalysisEngine.colors()[type]||'#9fc98a';
    return {type,labelAr,symbol,loss:cpLoss,cpLoss,moveAcc:AnalysisEngine.moveAccuracy(cpLoss,beforeCp,afterMoverCp),missedOpportunity,color,bg:color+'22',mover,beforeCp,afterCp:afterMoverCp,isBest};
  }
  static colors(){return {brilliant:'#37c6e0',best:'#5f9e6e',great:'#7fb87a',excellent:'#9fc98a',good:'#b5d4a0',inaccuracy:'#d9b64e',mistake:'#d98a3f',blunder:'#c95a4a',unrated:'#8c8175'};}
  static gameAccuracy(classifications,whiteCp,mover){
    const vals=[];
    for(const c of classifications){
      if(c.mover!==mover||typeof c.moveAcc!=='number')continue;
      vals.push(c.moveAcc);
    }
    if(!vals.length)return 0;
    return vals.reduce((a,b)=>a+b,0)/vals.length;
  }
  static formatETA(done,total,elapsedMs){if(!done||!total)return '...';const rem=((total-done)/done)*elapsedMs;return rem<60000?`${Math.ceil(rem/1000)}ث`:`${Math.ceil(rem/60000)}د`;}
  static formatNPS(nodes,elapsedMs){if(!nodes||elapsedMs<200)return '—';const nps=nodes/(elapsedMs/1000);return nps>=1e6?`${(nps/1e6).toFixed(1)}M/ث`:nps>=1000?`${Math.round(nps/1000)}K/ث`:`${Math.round(nps)}/ث`;}
  static evalLabel(result,fen){
    if(!result)return '—';
    const turn=(fen||'').split(/\s+/)[1]||'w';
    if(result.mate!==null&&result.mate!==undefined){let m=result.mate;if(turn==='b')m=-m;return m>0?`M${m}`:`-M${Math.abs(m)}`;}
    const cp=AnalysisEngine.resultToWhiteCp(result,fen);
    if(cp===null)return '—';
    return (cp>=0?'+':'')+(cp/100).toFixed(2);
  }
  destroy(){this.pool.forEach(s=>{try{s.worker.terminate();}catch(_){}});this.pool=[];this.ready=false;}
}
if(typeof window!=='undefined')window.AnalysisEngine=AnalysisEngine;
if(typeof module!=='undefined')module.exports=AnalysisEngine;
