const B='http://localhost:4321/api/';let F=0;const ok=(c,m)=>{console.log(c?'OK ':'FAIL',m);if(!c)F++};
const call=async(t,m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'content-type':'application/json',...(t?{'x-token':t}:{})},body:b?JSON.stringify(b):undefined});const j=await r.json();j.$=r.status;return j};
(async()=>{const tg='tt'+Date.now().toString(36).slice(-4);
const A=(await call(0,'POST','register',{nick:tg+'a',pw:'1234'})).token,Bt=(await call(0,'POST','register',{nick:tg+'b',pw:'1234'})).token;
await call(A,'POST','admin/claim',{code:'test-admin-code'});
let me=(await call(Bt,'GET','me')).me;ok(me.rank===0&&me.drawsLeft===1&&me.compMax===0,'rookie perks');
// draw
let d=await call(Bt,'GET','draw');ok(d.taken.length>=0&&d.left===1&&d.prizes.length===5,'draw state');
const free=[...Array(77).keys()].map(i=>i+1).filter(n=>!d.taken.some(t=>t.n===n));
const [p1,p2]=await Promise.all([call(Bt,'POST','draw/pick',{number:free[0]}),call(Bt,'POST','draw/pick',{number:free[1]})]);
ok([p1,p2].filter(x=>x.rank).length===1,'only 1 pick for rookie (concurrent)');
const won=p1.rank?p1:p2;console.log('  picked',won.number,won.rank,won.prize);
ok((await call(A,'POST','draw/pick',{number:won.number})).$===400,'taken number blocked');
// promote B to platinum by balance
const uid=(await call(A,'POST','admin/users',{search:tg+'b'})).users[0].id;
await call(A,'POST','admin/setbal',{id:uid,balance:20000000000});
me=(await call(Bt,'GET','me')).me;ok(me.rank===3&&me.drawsLeft===1&&me.compLeft===5&&me.dailyAmt===50000000,'platinum perks (draws 2 total → 1 left)');
ok((await call(Bt,'POST','react',{room:'lobby',code:28})).ok,'vip reaction allowed');
await new Promise(r=>setTimeout(r,1300));
ok((await call(Bt,'POST','react',{room:'lobby',code:31})).$===400,'heaven reaction blocked');
let c=await call(Bt,'POST','slot',{comp:true});ok(c.comp&&c.bet===50000000&&c.compLeft===4,'comp spin');
ok((await call(Bt,'POST','table/h3/sit',{seat:1,buyin:4000000000})).mySeat===1,'VIP table sit');await call(Bt,'POST','table/h3/leave');
ok((await call(A,'POST','table/h3/sit',{seat:2,buyin:4000000000})).$===400,'VIP blocked for rookie');
// drop tier by losing balance
await call(A,'POST','admin/setbal',{id:uid,balance:500000000});
me=(await call(Bt,'GET','me')).me;ok(me.rank===1&&me.compMax===0,'tier drops with balance');
ok((await call(Bt,'POST','slot',{comp:true})).$===400,'comp blocked after drop');
console.log(F?'FAILED '+F:'ALL PASSED')})();
