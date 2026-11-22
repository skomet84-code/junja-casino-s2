const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = 'http://localhost:4321/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const tag = Date.now().toString(36).slice(-4);
  async function user(nick) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(nick + ' PAGE ' + e.message)); p.on('console', m => m.type() === 'error' && !m.text().includes('fonts') && !m.text().includes('jsdelivr') && errs.push(nick + ' ' + m.text()));
    await p.goto(URL); await p.waitForSelector('#af');
    await p.click('#sw'); await p.fill('[name=nick]', nick); await p.fill('[name=pw]', '1234'); await p.fill('[name=pw2]', '1234'); await p.click('#af button');
    await p.waitForSelector('#v-lobby.on .hero'); return p;
  }
  const shot = (p, n) => p.screenshot({ path: `/home/claude/c2/shots/${n}.png` });
  const A = await user('갓준자' + tag), B = await user('민지' + tag), C = await user('철수' + tag);
  await sleep(600); await shot(A, '01-lobby');
  await A.evaluate(() => scrollTo(0, 700)); await sleep(200); await shot(A, '02-lobby-games'); await A.evaluate(() => scrollTo(0, 0));
  // reactions
  await B.click('#rxBtn'); await sleep(200); await shot(B, '03-react-sheet'); await B.click('.rx-sheet [data-c="16"]');
  await sleep(5500); await shot(A, '04-lobby-reaction');
  // solo: slot
  await A.evaluate(() => S2.go('slot')); await A.waitForSelector('#v-slot.on #spin');
  for (let i = 0; i < 3; i++) { await A.click('#spin'); await sleep(2600); }
  await shot(A, '05-slot');
  // bj
  await A.evaluate(() => S2.go('bj')); await A.waitForSelector('#deal');
  await A.click('#deal'); await sleep(900);
  for (let k = 0; k < 4; k++) { if (await A.isVisible('#acts:not(.hide)')) { await A.click('[data-a="stand"]'); await sleep(2500); } }
  await shot(A, '06-bj');
  // plinko
  await A.evaluate(() => S2.go('plinko')); await A.waitForSelector('#d10'); await sleep(300);
  await A.click('#d10'); await sleep(1300); await shot(A, '07-plinko'); await sleep(3500);
  // mines
  await A.evaluate(() => S2.go('mines')); await A.waitForSelector('#ms'); await A.click('#ms'); await sleep(400);
  for (const i of [0, 6, 12]) { const t = await A.$(`.tile[data-i="${i}"]:not([disabled])`); if (t && await A.isVisible('#mcash:not(.hide)')) { await t.click(); await sleep(500); } }
  await shot(A, '08-mines');
  if (await A.isVisible('#mcash:not(.hide)')) { if (await A.isEnabled('#mcash')) await A.click('#mcash'); await sleep(500); }
  // dice
  await A.evaluate(() => S2.go('dice')); await A.waitForSelector('#dgo'); await A.click('#dgo'); await sleep(1200); await shot(A, '09-dice');
  // vpoker
  await A.evaluate(() => S2.go('vpoker')); await A.waitForSelector('#vgo'); await A.click('#vgo'); await sleep(900);
  await A.click('.vp-hand .slotc:nth-child(1)'); await A.click('.vp-hand .slotc:nth-child(2)'); await shot(A, '10-vpoker-hold');
  await A.click('#vgo'); await sleep(900); await shot(A, '11-vpoker');
  // hilo
  await A.evaluate(() => S2.go('hilo')); await A.waitForSelector('#hstart'); await A.click('#hstart'); await sleep(600);
  for (let k = 0; k < 2; k++) { if (!(await A.isVisible('#ha:not(.hide)'))) break; const lo = await A.isEnabled('#hlo'); await A.click(lo ? '#hlo' : '#hhi'); await sleep(600); }
  await shot(A, '12-hilo');
  // live crash: all three
  for (const p of [A, B, C]) await p.evaluate(() => S2.go('crash'));
  await A.waitForSelector('#cgo');
  // wait for bet phase
  for (let i = 0; i < 40; i++) { const t = await A.textContent('#cgo'); if (t.includes('탑승하기')) break; await sleep(500); }
  await B.fill('#ca', '1.2');
  for (const p of [A, B, C]) { try { await p.click('#cgo', { timeout: 3000 }); } catch {} }
  await sleep(1200); await shot(C, '13-crash-bet');
  await C.click('#rxBtn'); await sleep(200); await C.click('.rx-sheet [data-c="12"]');
  for (let i = 0; i < 40; i++) { const t = await A.textContent('#cgo'); if (t.includes('회수 ·')) break; await sleep(250); }
  await sleep(700); await shot(A, '14-crash-fly');
  try { await A.click('#cgo', { timeout: 1000 }); } catch {}
  await sleep(1000); await shot(B, '15-crash-cashed');
  for (let i = 0; i < 60; i++) { const t = await A.textContent('#cs'); if (t.includes('폭발') || t.includes('회수 성공')) break; await sleep(500); }
  await sleep(1500); await shot(A, '16-crash-end');
  // live baccarat
  for (const p of [A, B, C]) await p.evaluate(() => S2.go('bac'));
  await A.waitForSelector('.spot');
  for (let i = 0; i < 40; i++) { const t = await A.textContent('#btm'); if (t.includes('베팅') && parseFloat(t.replace(/[^0-9.]/g, '')) > 5) break; await sleep(500); }
  await A.click('.spot[data-s="player"]'); await B.click('.spot[data-s="banker"]'); await B.click('.spot[data-s="banker"]'); await C.click('.spot[data-s="tie"]'); await C.click('.spot[data-s="ppair"]');
  await sleep(1500); await shot(A, '17-bac-bet');
  for (let i = 0; i < 40; i++) { const t = await A.textContent('#btm'); if (t.includes('딜링')) break; await sleep(500); }
  await sleep(6500); await shot(A, '18-bac-result');
  await A.evaluate(() => scrollTo(0, 600)); await sleep(200); await shot(A, '19-bac-road');
  // holdem with A,B,C via UI
  for (const p of [A, B, C]) await p.evaluate(() => S2.go('tables'));
  await sleep(800); await shot(A, '20-tables');
  for (const p of [A, B, C]) await p.evaluate(() => S2.go('table-h1'));
  await sleep(1500);
  const sit = async (p, seat) => { await p.click(`[data-sit="${seat}"]`); await p.waitForSelector('#bgo'); await p.click('#bgo'); await sleep(500); };
  await sit(A, 0); await sleep(1300); await sit(B, 2); await sleep(1300); await sit(C, 4);
  let acted = 0;
  for (let i = 0; i < 90 && acted < 14; i++) {
    for (const p of [A, B, C]) {
      const btn = await p.$('#acts [data-a="call"], #acts [data-a="check"]');
      if (btn) { if (acted === 2) await shot(p, '21-holdem-turn'); try { await btn.click({ timeout: 1000 }); acted++; } catch {} await sleep(700); }
    }
    await sleep(500);
  }
  await sleep(500); await shot(A, '22-holdem'); await shot(B, '23-holdem-B');
  for (let i = 0; i < 20; i++) { const ph = await A.evaluate(() => document.querySelector('.banner') ? 1 : 0); if (ph) break; await sleep(300); }
  await shot(C, '24-holdem-show');
  for (const p of [A, B, C]) { try { await p.click('#tleave', { timeout: 1500 }); await p.click('.modal [data-a="1"]', { timeout: 1500 }); } catch {} }
  // seotda A vs B
  for (const p of [A, B]) await p.evaluate(() => S2.go('table-s1'));
  await sleep(1500); await sit(A, 1); await sleep(1000); await sit(B, 3);
  acted = 0;
  for (let i = 0; i < 60 && acted < 4; i++) {
    for (const p of [A, B]) { const btn = await p.$('#acts [data-a="call"], #acts [data-a="check"]'); if (btn) { if (acted === 0) await shot(p, '25-seotda-turn'); try { await btn.click({ timeout: 1000 }); acted++; } catch {} await sleep(800); } }
    await sleep(500);
  }
  await sleep(800); await shot(A, '26-seotda');
  for (const p of [A, B]) { try { await p.click('#tleave', { timeout: 1500 }); await p.click('.modal [data-a="1"]', { timeout: 1500 }); } catch {} }
  // ranking & me
  await A.evaluate(() => S2.go('rank')); await sleep(900); await shot(A, '27-rank');
  await A.evaluate(() => S2.go('me')); await sleep(900); await shot(A, '28-me');
  // admin
  await A.goto(URL + 'admin'); await A.waitForSelector('#claim, #at'); await shot(A, '29-admin-claim');
  if (await A.$('#claim')) { await A.fill('#code', 'test-admin-code'); await A.click('#claim'); }
  await A.waitForSelector('#at'); await sleep(600); await shot(A, '30-admin-dash');
  await A.setViewportSize({ width: 1100, height: 900 }); await sleep(300); await shot(A, '31-admin-desktop');
  await A.click('[data-t="users"]'); await sleep(800); await A.click('tr[data-id]'); await sleep(800); await shot(A, '32-admin-user');
  await A.click('#dx'); await A.click('[data-t="games"]'); await sleep(600); await shot(A, '33-admin-games');
  console.log('ERRORS', JSON.stringify(errs, null, 1));
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
