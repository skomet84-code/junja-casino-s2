const C=require('../lib/cards');const T=require('../lib/tables');
const c=(r,s)=>({r,s});let f=0;const ok=(x,m)=>{if(!x){f++;console.log('✗',m)}};
// poker eval
const e=cs=>C.bestHand(cs);
ok(e([c('A','♠'),c('K','♠'),c('Q','♠'),c('J','♠'),c('10','♠'),c('2','♥'),c('3','♦')]).score[0]===8,'royal');
ok(e([c('A','♠'),c('2','♥'),c('3','♠'),c('4','♣'),c('5','♠'),c('K','♥'),c('K','♦')]).score.join()==='4,5','wheel');
ok(C.cmp(e([c('A','♠'),c('A','♥'),c('K','♠'),c('Q','♣'),c('9','♠'),c('2','♥'),c('3','♦')]).score,e([c('A','♦'),c('A','♣'),c('K','♦'),c('J','♣'),c('9','♦'),c('2','♣'),c('3','♣')]).score)>0,'kicker');
ok(e([c('9','♠'),c('9','♥'),c('9','♦'),c('4','♣'),c('4','♠'),c('4','♥'),c('2','♦')]).score[0]===6,'fullhouse from two trips');
// seotda
const h=(m,k)=>({m,k});const R=(a,b)=>C.seotdaRank(a,b);
ok(R(h(3,'g'),h(8,'g')).name==='38광땡','38');ok(R(h(1,'g'),h(8,'g')).v===900,'18');ok(R(h(10,'a'),h(10,'b')).name==='장땡','장땡');
ok(R(h(2,'a'),h(1,'b')).name==='알리','알리');ok(R(h(4,'y'),h(7,'y')).special==='amhaeng','암행');ok(R(h(3,'b'),h(7,'b')).special==='ttaengjab','땡잡이');
ok(R(h(5,'a'),h(4,'b')).name==='갑오','갑오');ok(R(h(2,'a'),h(8,'b')).name==='망통','망통');ok(R(h(9,'y'),h(4,'y')).special==='mgusa','멍구사');
// side pots: A all-in 100, B 300, C 300 folded? 
const st={hand:{carry:0},seats:[{inHand:1,total:100,folded:false},{inHand:1,total:300,folded:false},{inHand:1,total:300,folded:true},null,null,null]};
const p=T._test.pots(st);ok(p.length===2&&p[0].amount===300&&p[0].elig.length===2&&p[1].amount===400&&p[1].elig.join()==='1','sidepots '+JSON.stringify(p));
// full holdem hand simulation with all-in side pot + showdown conservation, many random hands
const core=require('../lib/core');
let total=0;
for(let n=0;n<3000;n++){
 const st=T._test.emptyState('h1');const stacks=[];
 for(let i=0;i<6;i++){ if(Math.random()<0.7){const stack=20000*(5+Math.floor(Math.random()*100));stacks.push(stack);st.seats[i]={uid:'u'+i,nick:'p'+i,stack,missed:0,inHand:false,folded:false,allin:false,bet:0,total:0,acted:false,cards:[]};} }
 const before=st.seats.reduce((a,s)=>a+(s?s.stack:0),0); let now=1e6; const eff=[];
 T._test.tick(st,now,eff); now+=4000; T._test.tick(st,now,eff);
 if(st.phase!=='play'){continue;}
 let g=0;
 while(st.phase==='play'&&g++<200){const i=st.hand.toAct,s=st.seats[i];const toCall=st.hand.curBet-s.bet;const r=Math.random();
   let a= r<0.15?{type:'fold'}: r<0.25?{type:'allin'}: r<0.45?{type:'raise',amount:st.hand.curBet+st.hand.minRaise+Math.floor(Math.random()*3)*20000}: {type:toCall>0?'call':'check'};
   try{T._test.doAction(st,i,a,now,false);}catch(e){T._test.doAction(st,i,{type:toCall>0?'call':'check'},now,false);}
   T._test.advance(st,now,eff);}
 if(st.phase!=='show'){ok(false,'hand did not end '+st.phase);break;}
 const after=st.seats.reduce((a,s)=>a+(s?s.stack:0),0);
 if(after!==before){ok(false,`conservation ${before}->${after}`);break;}
 const led=eff.filter(e=>e.t==='ledger');if(led.reduce((a,e)=>a+e.payout-e.wager,0)!==0){ok(false,'ledger zero-sum');break;}
 total++;
}
console.log('holdem sims',total);
// seotda sims
let tot2=0;
for(let n=0;n<3000;n++){
 const st=T._test.emptyState('s1');
 for(let i=0;i<6;i++) if(Math.random()<0.6) st.seats[i]={uid:'u'+i,nick:'p'+i,stack:10000*(3+Math.floor(Math.random()*60)),missed:0,cards:[]};
 const before=st.seats.reduce((a,s)=>a+(s?s.stack:0),0);let now=1e6;const eff=[];
 T._test.tick(st,now,eff);now+=4000;T._test.tick(st,now,eff); if(st.phase!=='play')continue;
 let g=0; while(st.phase==='play'&&g++<200){const i=st.hand.toAct,s=st.seats[i];const toCall=st.hand.curBet-s.bet;const r=Math.random();
  const a=r<0.2?{type:'fold'}:r<0.3?{type:'half'}:r<0.4?{type:'ddadang'}:r<0.5?{type:'bbing'}:r<0.55?{type:'allin'}:{type:toCall>0?'call':'check'};
  try{T._test.doAction(st,i,a,now,false);}catch(e){T._test.doAction(st,i,{type:toCall>0?'call':'check'},now,false);} T._test.advance(st,now,eff);}
 if(st.phase!=='show'){ok(false,'seotda not ended');break;}
 const after=st.seats.reduce((a,s)=>a+(s?s.stack:0),0); if(after!==before){ok(false,`seotda conservation ${before}->${after} ${JSON.stringify(st.last)}`);break;}
 tot2++;
}
console.log('seotda sims',tot2, f?'FAIL '+f:'ALL OK');
