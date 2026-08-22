/* Chessjust persistent local progress — no API/account required. */
(function(){
  const KEY='chessjust_progress_v2';
  const defaults={version:2,tactics:{rating:800,solved:0,correct:0,streak:0,bestStreak:0,seen:[],mistakes:[],byMotif:{},points:0,currentStage:0},puzzles:{rating:2500,solved:0,correct:0,streak:0,bestStreak:0,seen:[],points:0,currentStage:0},openings:{mastered:[],attempts:0,correct:0,currentOpening:0,currentBranch:0,progress:{}},challenges:{completed:0},settings:{theme:'dark'}};
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function load(){try{const x=JSON.parse(localStorage.getItem(KEY)||'null');return Object.assign(clone(defaults),x||{},{tactics:Object.assign(clone(defaults.tactics),x?.tactics||{}),puzzles:Object.assign(clone(defaults.puzzles),x?.puzzles||{}),openings:Object.assign(clone(defaults.openings),x?.openings||{}),challenges:Object.assign(clone(defaults.challenges),x?.challenges||{}),settings:Object.assign(clone(defaults.settings),x?.settings||{})});}catch(e){return clone(defaults)}}
  let data=load();
  function save(){try{localStorage.setItem(KEY,JSON.stringify(data));}catch(e){}}
  window.CJProgress={
    get:()=>clone(data), save, reset:()=>{data=clone(defaults);save();return data;},
    recordTactic:(ok,motif,id)=>{const t=data.tactics;if(ok){t.solved++;t.correct++;t.streak++;t.points+=20;t.currentStage=Math.min(60,t.solved);}else{t.streak=0;t.mistakes.push({id,motif,date:Date.now()});}t.bestStreak=Math.max(t.bestStreak,t.streak);t.rating=Math.max(400,Math.min(2800,t.rating+(ok?Math.max(4,Math.round((2200-t.rating)/80)):-Math.max(3,Math.round((t.rating-800)/140)))));if(id&&!t.seen.includes(id))t.seen.push(id);if(motif)t.byMotif[motif]=(t.byMotif[motif]||0)+(ok?1:0);save();return clone(t);},
    recordPuzzle:(ok,id)=>{const p=data.puzzles;if(ok){p.solved++;p.correct++;p.streak++;p.points+=20;p.currentStage=Math.min(60,p.solved);}else{p.streak=0;}p.bestStreak=Math.max(p.bestStreak,p.streak);p.rating=Math.max(800,Math.min(3000,p.rating+(ok?12:-10)));if(id&&!p.seen.includes(id))p.seen.push(id);save();return clone(p);},
    opening:(id,ok,openingIndex,branchIndex,pos)=>{data.openings.attempts++;if(ok){data.openings.correct++;if(id&&!data.openings.mastered.includes(id))data.openings.mastered.push(id);}if(openingIndex!=null)data.openings.currentOpening=openingIndex;if(branchIndex!=null)data.openings.currentBranch=branchIndex;if(id!=null&&pos!=null)data.openings.progress[id]=pos;save();return clone(data.openings);},
    challenge:()=>{data.challenges.completed++;save();}, snapshot:()=>clone(data)
  };
})();
