// End-to-end API test against local server with several simultaneous users
const BASE = 'http://localhost:4321/api/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗', m); } else console.log('  ✓', m); };
async function call(tok, method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { 'x-token': tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); j.__status = r.status; return j;
}
const mk = async nick => { const r = await call(null, 'POST', 'register', { nick, pw: '1234' }); if (!r.token) throw Error(JSON.stringify(r)); return r.token; };
const bal = async t => (await call(t, 'GET', 'me')).me.bal;

(async () => {
  const tag = Date.now().toString(36).slice(-4);
  console.log('AUTH');
  const A = await mk('갓준자' + tag), B = await mk('bob' + tag), Cc = await mk('cat' + tag);
  ok((await call(null, 'POST', 'register', { nick: '갓준자' + tag, pw: 'x1234' })).__status === 400, 'duplicate nick refused');
  ok((await call(null, 'POST', 'login', { nick: 'bob' + tag, pw: 'nope' })).__status === 400, 'wrong pw refused');
  ok(!!(await call(null, 'POST', 'login', { nick: 'BOB' + tag, pw: '1234' })).token, 'login case-insensitive');
  ok(await bal(A) === 100000000, 'start balance 1억');
  ok((await call(A, 'POST', 'daily')).amount === 10000000, 'daily bonus');
  ok((await call(A, 'POST', 'daily')).__status === 400, 'daily only once');

  console.log('SOLO');
  let b0 = await bal(B);
  let r = await call(B, 'POST', 'slot', { bet: 100000 });
  ok(r.grid && r.grid.length === 5, 'slot spin grid');
  ok(await bal(B) === b0 - 100000 + r.payout, 'slot balance consistent');
  r = await call(B, 'POST', 'slot', { bet: 999999999999 }); ok(r.__status === 400, 'over max bet refused');
  b0 = await bal(B); r = await call(B, 'POST', 'plinko', { bet: 10000, risk: 'high', count: 5 });
  ok(r.drops.length === 5 && await bal(B) === b0 - 50000 + r.drops.reduce((a, d) => a + d.payout, 0), 'plinko x5 consistent');
  b0 = await bal(B); r = await call(B, 'POST', 'dice', { bet: 10000, target: 50, over: false });
  ok(typeof r.roll === 'number' && await bal(B) === b0 - 10000 + r.payout, 'dice');
  // blackjack
  b0 = await bal(B); r = await call(B, 'POST', 'bj', { action: 'deal', bet: 100000 });
  let guard = 0; while (r.game && r.game.state === 'play' && guard++ < 10) r = await call(B, 'POST', 'bj', { action: r.game.hands[r.game.active].score.total < 16 ? 'hit' : 'stand' });
  ok(r.game.state === 'done', 'bj finished: ' + r.game.hands.map(h => h.result).join('/'));
  ok(await bal(B) === b0 - r.game.wagered + r.game.payout, 'bj balance consistent');
  // concurrency: two simultaneous deals must not both succeed
  const pair = await Promise.all([call(B, 'POST', 'hilo', { action: 'start', bet: 10000 }), call(B, 'POST', 'hilo', { action: 'start', bet: 10000 })]);
  ok(pair.filter(p => p.game).length === 1, 'double start blocked');
  b0 = await bal(B);
  // mines
  r = await call(B, 'POST', 'mines', { action: 'start', bet: 10000, mines: 3 });
  ok(r.game && r.game.m === 3, 'mines start');
  // vpoker
  r = await call(B, 'POST', 'vpoker', { action: 'deal', bet: 10000 }); ok(r.game.hand.length === 5, 'vpoker deal');
  r = await call(B, 'POST', 'vpoker', { action: 'draw', holds: [true, true, false, false, false] }); ok(r.hand.length === 5, 'vpoker draw ' + (r.result || 'no hand'));

  console.log('REACT');
  ok((await call(A, 'POST', 'react', { room: 'lobby', code: 12 })).ok, 'react');
  ok((await call(A, 'POST', 'react', { room: 'lobby', code: 1 })).__status === 400, 'react rate limit');
  ok((await call(B, 'GET', 'lobby')).reacts.length >= 1, 'others see reaction');

  console.log('LIVE CRASH');
  let s = await call(A, 'GET', 'crash');
  while (s.round.phase !== 'bet' || s.round.flyAt - s.now < 2500) { await sleep(500); s = await call(A, 'GET', 'crash'); }
  const n = s.round.n;
  const bA = await bal(A), bB = await bal(B), bC = await bal(Cc);
  ok((await call(A, 'POST', 'crash/bet', { bet: 100000 })).ok, 'A bet');
  ok((await call(B, 'POST', 'crash/bet', { bet: 200000, auto: 1.01 })).ok, 'B bet auto 1.01');
  ok((await call(Cc, 'POST', 'crash/bet', { bet: 300000 })).ok, 'C bet');
  ok((await call(Cc, 'POST', 'crash/bet', { bet: 300000 })).__status === 400, 'double bet refused');
  s = await call(Cc, 'GET', 'crash'); ok(s.bets.length >= 3, 'everyone sees bets (' + s.bets.length + ')');
  { const off = s.now - Date.now(); while (Date.now() + off < s.round.flyAt + 400) await sleep(100); }
  const co = await call(A, 'POST', 'crash/cashout');
  console.log('    A cashout', co.mult || co.error);
  do { await sleep(700); s = await call(A, 'GET', 'crash'); } while (s.round.n === n && s.round.phase !== 'end');
  await sleep(1600); s = await call(A, 'GET', 'crash');
  const hist = await call(A, 'GET', 'history');
  const point = s.hist[0];
  console.log('    crash point', point);
  const eA = await bal(A), eB = await bal(B), eC = await bal(Cc);
  ok(eA === bA - 100000 + (co.payout || 0), 'A settled');
  ok(eB === bB - 200000 + (point >= 1.01 ? 202000 : 0), 'B auto settled');
  ok(eC === bC - 300000, 'C lost');
  ok(hist.history.some(h => h.game === 'crash'), 'crash ledger');

  console.log('LIVE BACCARAT');
  let bs = await call(A, 'GET', 'bac');
  while (bs.round.phase !== 'bet' || bs.round.dealAt - bs.now < 3000) { await sleep(700); bs = await call(A, 'GET', 'bac'); }
  const bn = bs.round.n, ba = await bal(A), bb2 = await bal(B);
  ok((await call(A, 'POST', 'bac/bet', { spot: 'player', amount: 100000 })).ok, 'A player');
  ok((await call(A, 'POST', 'bac/bet', { spot: 'player', amount: 100000 })).ok, 'A player again (stack)');
  ok((await call(A, 'POST', 'bac/bet', { spot: 'banker', amount: 100000 })).__status === 400, 'A cannot bet both sides');
  ok((await call(B, 'POST', 'bac/bet', { spot: 'tie', amount: 50000 })).ok, 'B tie');
  bs = await call(B, 'GET', 'bac'); ok(bs.totals.player === 200000 && bs.players.length >= 2, 'shared totals');
  while (true) { await sleep(800); bs = await call(A, 'GET', 'bac'); if (bs.round.n === bn && bs.round.phase === 'deal' && Date.now() > bs.round.dealAt + 1700) break; if (bs.round.n !== bn) break; }
  await sleep(500); bs = await call(A, 'GET', 'bac');
  const road = bs.road; const res = road.filter(Boolean).slice(-1)[0];
  const w = (await call(A, 'GET', 'history')).history.find(h => h.game === 'bac');
  ok(w && w.wager === 200000, 'bac ledger A ' + (w && w.note));
  const expA = res.w === 'player' ? 400000 : res.w === 'tie' ? 200000 : 0;
  ok(await bal(A) === ba - 200000 + expA, 'A bac balance (' + res.w + ')');
  ok(await bal(B) === bb2 - 50000 + (res.w === 'tie' ? 450000 : 0), 'B bac balance');

  console.log('HOLDEM');
  const T = 'h1';
  await call(A, 'POST', `table/${T}/leave`); await call(B, 'POST', `table/${T}/leave`); await call(Cc, 'POST', `table/${T}/leave`);
  let tA0 = await bal(A), tB0 = await bal(B), tC0 = await bal(Cc);
  ok((await call(A, 'POST', `table/${T}/sit`, { seat: 0, buyin: 1000000 })).mySeat === 0, 'A sits');
  ok((await call(B, 'POST', `table/${T}/sit`, { seat: 0, buyin: 1000000 })).__status === 400, 'seat taken refused');
  ok((await call(B, 'POST', `table/${T}/sit`, { seat: 2, buyin: 1000000 })).mySeat === 2, 'B sits');
  ok((await call(Cc, 'POST', `table/${T}/sit`, { seat: 4, buyin: 500000 })).mySeat === 4, 'C sits');
  const toks = { 0: A, 2: B, 4: Cc };
  let st; let hands = 0, lastHand = 0, steps = 0;
  while (hands < 3 && steps++ < 200) {
    st = await call(A, 'GET', `table/${T}`);
    if (st.phase === 'play') {
      if (st.handNo !== lastHand) { lastHand = st.handNo; hands++; console.log('    hand', st.handNo, 'dealer', st.dealer); }
      const who = st.toAct, t = toks[who];
      const v = await call(t, 'GET', `table/${T}`);
      ok(v.seats.filter((s, i) => s && i !== who && s.inHand).every(s => s.cards.every(c => c === null)) || v.phase !== 'play', 'opponent cards hidden');
      let action;
      if (hands === 1) action = { type: 'call' };                                     // limp to showdown
      else if (hands === 2) action = who === 4 ? { type: 'allin' } : { type: 'call' }; // all-in side pot scenario
      else action = { type: v.me && v.me.toCall > 0 ? 'fold' : 'check' };
      const r2 = await call(t, 'POST', `table/${T}/act`, action);
      if (r2.__status !== 200) console.log('    act err', r2.error);
    } else await sleep(900);
  }
  st = await call(A, 'GET', `table/${T}`);
  console.log('    last', JSON.stringify(st.last && st.last.winners));
  // chip conservation: stacks + wallets == before
  await call(A, 'POST', `table/${T}/leave`); await call(B, 'POST', `table/${T}/leave`); await call(Cc, 'POST', `table/${T}/leave`);
  for (let i = 0; i < 12; i++) { st = await call(A, 'GET', `table/${T}`); if (st.seats.every(s => !s)) break; await sleep(1000); }
  const total0 = tA0 + tB0 + tC0, total1 = await bal(A) + await bal(B) + await bal(Cc);
  ok(total0 === total1, `holdem chips conserved (${total0} → ${total1})`);

  console.log('SEOTDA');
  const S = 's1'; tA0 = await bal(A); tB0 = await bal(B);
  await call(A, 'POST', `table/${S}/sit`, { seat: 1, buyin: 1000000 }); await call(B, 'POST', `table/${S}/sit`, { seat: 3, buyin: 1000000 });
  const st2 = { 1: A, 3: B }; hands = 0; lastHand = 0; steps = 0;
  while (hands < 3 && steps++ < 150) {
    st = await call(A, 'GET', `table/${S}`);
    if (st.phase === 'play') {
      if (st.handNo !== lastHand) { lastHand = st.handNo; hands++; }
      const t = st2[st.toAct]; const v = await call(t, 'GET', `table/${S}`);
      const action = hands === 1 ? (v.me.toCall ? { type: 'call' } : { type: 'half' }) : hands === 2 ? { type: v.me.toCall ? 'call' : 'ddadang' } : { type: 'fold' };
      const r2 = await call(t, 'POST', `table/${S}/act`, action); if (r2.__status !== 200) console.log('    act err', r2.error);
    } else { if (st.phase === 'show' && st.last) console.log('    seotda', JSON.stringify(st.last.winners || st.last.replay)); await sleep(1500); }
  }
  await call(A, 'POST', `table/${S}/leave`); await call(B, 'POST', `table/${S}/leave`);
  for (let i = 0; i < 12; i++) { st = await call(A, 'GET', `table/${S}`); if (st.seats.every(s => !s)) break; await sleep(1000); }
  ok(tA0 + tB0 === await bal(A) + await bal(B), 'seotda chips conserved');

  console.log('ADMIN');
  ok((await call(B, 'POST', 'admin/dashboard')).__status === 403, 'non-admin blocked');
  ok((await call(A, 'POST', 'admin/claim', { code: 'wrong' })).__status === 400, 'wrong admin code');
  ok((await call(A, 'POST', 'admin/claim', { code: 'test-admin-code' })).ok, 'admin claim');
  const d = await call(A, 'POST', 'admin/dashboard'); ok(d.users >= 3 && Array.isArray(d.week), 'dashboard');
  const us = await call(A, 'POST', 'admin/users', { search: 'bob' + tag }); ok(us.users.length === 1, 'user search');
  const bid = us.users[0].id, before = us.users[0].bal;
  ok((await call(A, 'POST', 'admin/adjust', { id: bid, amount: 5000000, memo: '테스트' })).bal === before + 5000000, 'admin give');
  ok((await call(A, 'POST', 'admin/ban', { id: bid, banned: true })).ok && (await call(B, 'GET', 'me')).me === null, 'ban kicks session');
  await call(A, 'POST', 'admin/ban', { id: bid, banned: false });
  const tmp = (await call(A, 'POST', 'admin/resetpw', { id: bid })).temp; ok(!!(await call(null, 'POST', 'login', { nick: 'bob' + tag, pw: tmp })).token, 'temp pw works');
  await call(A, 'POST', 'admin/settings', { disabled: { dice: true }, notice: '공지 테스트' });
  ok((await call(A, 'POST', 'dice', { bet: 10000, target: 50 })).__status === 400, 'disabled game blocked');
  await call(A, 'POST', 'admin/settings', { disabled: {}, notice: '' });
  ok((await call(A, 'POST', 'admin/log')).log.length >= 4, 'audit log');
  console.log(fails ? `\nFAILED ${fails}` : '\nALL PASSED');
})().catch(e => { console.error(e); process.exit(1); });
