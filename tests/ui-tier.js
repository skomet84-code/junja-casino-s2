const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));const {execSync}=require('child_process');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs=[];const tag='뷰'+Date.now().toString(36).slice(-4);
  const mk=async(nick)=>{const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));
    await p.goto('http://localhost:4321/');await p.waitForSelector('#af');await p.click('#sw');await p.fill('[name=nick]',nick);await p.fill('[name=pw]','1234');await p.fill('[name=pw2]','1234');await p.click('#af button');await p.waitForSelector('#v-lobby.on .hero');return p;};
  const setBal=(nick,v)=>execSync(`psql -q -d casino -c "UPDATE users SET bal=${v}, last_seen=0 WHERE nick='${nick}'"`);
  const A=await mk(tag+'a'), Bp=await mk(tag+'b');
  const shot=(p,n)=>p.screenshot({path:'shots/t'+n+'.png'});
  const bals=[100000000,500000000,5000000000,50000000000,500000000000,5000000000000];
  for(let i=0;i<6;i++){setBal(tag+'a',bals[i]);await A.evaluate(()=>S2.refreshMe());await A.evaluate(()=>S2.go('lobby'));await sleep(200);await A.evaluate(()=>S2.go('me'));await sleep(900);await shot(A,'0'+i+'-me');}
  await A.evaluate(()=>scrollTo(0,650));await sleep(300);await shot(A,'06-privileges');await A.evaluate(()=>scrollTo(0,1400));await sleep(300);await shot(A,'07-lounge');
  setBal(tag+'b',50000000000);await Bp.evaluate(()=>S2.refreshMe());
  await A.evaluate(()=>S2.go('lobby'));await sleep(1500);await shot(A,'08-lobby');await A.evaluate(()=>scrollTo(0,520));await sleep(300);await shot(A,'09-lobby-perks');
  await A.evaluate(()=>S2.go('draw'));await sleep(1200);await shot(A,'10-draw');
  await A.click('.star:not([disabled])');await sleep(1500);await shot(A,'11-draw-reveal');
  await A.click('.modal [data-x]').catch(()=>{});await A.evaluate(()=>document.querySelectorAll('.bigwin').forEach(e=>e.click()));await sleep(400);
  await A.evaluate(()=>scrollTo(0,500));await sleep(300);await shot(A,'12-draw-grid');
  await Bp.evaluate(()=>S2.go('rank'));await sleep(1000);await shot(Bp,'13-rank');
  await A.evaluate(()=>S2.go('tables'));await sleep(800);await shot(A,'14-tables');
  for(const p of [A,Bp]) await p.evaluate(()=>S2.go('table-h1'));await sleep(1200);
  for(const [p,s] of [[A,0],[Bp,3]]){await p.click(`[data-sit="${s}"]`);await p.click('#bgo');await sleep(1300);}
  await sleep(4000);await shot(Bp,'15-table-frames');
  await Bp.click('#rxBtn');await sleep(300);await shot(Bp,'16-rx-locks');
  await A.evaluate(()=>S2.go('slot'));await sleep(1200);await shot(A,'17-slot-comp');
  await A.click('#comp');await sleep(3500);await shot(A,'18-slot-comp-done');
  console.log('ERR',JSON.stringify(errs));await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
