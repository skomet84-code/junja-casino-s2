'use strict';
// Shared real-time rounds advanced lazily on every request (no background worker needed).
const S2 = require('./engine');
const C = require('./cards');
const core = require('./core');
const { q, one, num } = require('./db');
const { bad, betAmount, debit, credit, ledger } = core;

// ================= LIVE CRASH =================
const CR_BET_MS = 7000, CR_COOL_MS = 3500, CR_K = 0.11;
const crashMult = ms => Math.floor(Math.exp(CR_K * ms / 1000) * 100) / 100;
function crRow(r) { return r && { n: num(r.n), created: num(r.created), fly_at: num(r.fly_at), point: num(r.point), crash_at: num(r.crash_at), settled: num(r.settled) }; }
async function crashCurrent(now) {
  let r = crRow(await one(`SELECT * FROM crash_rounds ORDER BY n DESC LIMIT 1`));
  if (!r || now >= r.crash_at + CR_COOL_MS) {
    if (r && !r.settled) await crashSettle(r);
    const n = r ? r.n + 1 : 1;
    const point = Math.round(S2.crashPoint() * 100);
    const created = now, fly = created + CR_BET_MS;
    const crashAt = fly + Math.round(S2.crashTime(point / 100) * 1000);
    await q(`INSERT INTO crash_rounds(n,created,fly_at,point,crash_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (n) DO NOTHING`, [n, created, fly, point, crashAt]);
    r = crRow(await one(`SELECT * FROM crash_rounds ORDER BY n DESC LIMIT 1`));
    if (Math.random() < 0.05) q(`DELETE FROM crash_bets WHERE round < $1`, [r.n - 500]).then(() => q(`DELETE FROM crash_rounds WHERE n < $1`, [r.n - 500])).catch(() => {});
  }
  if (now >= Math.max(r.crash_at, r.fly_at + 1500) && !r.settled) await crashSettle(r);
  return r;
}
async function crashSettle(r) {
  const got = await q(`UPDATE crash_rounds SET settled=1 WHERE n=$1 AND settled=0 RETURNING n`, [r.n]);
  if (!got.length) return;
  const winners = await q(`UPDATE crash_bets SET cashed=auto, payout=FLOOR(amount*auto/100.0) WHERE round=$1 AND cashed=0 AND auto>0 AND auto<=$2::int RETURNING user_id, amount, auto, payout`, [r.n, r.point]);
  for (const w of winners) { await credit(w.user_id, num(w.payout)); }
  await q(`UPDATE crash_bets SET cashed=-1 WHERE round=$1 AND cashed=0`, [r.n]);
  const all = await q(`SELECT user_id, amount, cashed, payout FROM crash_bets WHERE round=$1`, [r.n]);
  for (const b of all) {
    const c = num(b.cashed);
    await ledger(b.user_id, 'crash', num(b.amount), num(b.payout), c > 0 ? `#${r.n} ${(c / 100).toFixed(2)}× 회수 (폭발 ${(r.point / 100).toFixed(2)}×)` : `#${r.n} ${(r.point / 100).toFixed(2)}×에서 폭발`);
  }
}
async function crashState(u, since) {
  await core.assertGame('crash');
  const now = Date.now(), r = await crashCurrent(now);
  const ended = now >= r.crash_at;
  const bets = await q(`SELECT user_id,nick,amount,auto,cashed,payout FROM crash_bets WHERE round=$1 ORDER BY amount DESC LIMIT 60`, [r.n]);
  const hist = await q(`SELECT n,point FROM crash_rounds WHERE crash_at<=$1 ORDER BY n DESC LIMIT 24`, [now]);
  const reacts = await core.reactionsSince('crash', since || 0);
  return {
    now, round: { n: r.n, created: r.created, flyAt: r.fly_at, phase: now < r.fly_at ? 'bet' : ended ? 'end' : 'fly', point: ended ? r.point / 100 : null, crashAt: ended ? r.crash_at : null, nextAt: r.crash_at + CR_COOL_MS },
    bets: bets.map(b => { const c = num(b.cashed); return { me: u && b.user_id === u.id, uid: b.user_id, nick: b.nick, amount: num(b.amount), cashed: c > 0 ? c / 100 : c < 0 ? -1 : 0, payout: num(b.payout), auto: u && b.user_id === u.id ? num(b.auto) / 100 : undefined }; }),
    hist: hist.map(h => num(h.point) / 100), reacts, k: CR_K
  };
}
async function crashBet(u, body) {
  await core.assertGame('crash');
  const now = Date.now(), r = await crashCurrent(now);
  if (now >= r.fly_at - 150) throw bad('이번 판 베팅이 마감됐어요. 다음 판을 기다려 주세요.');
  const amt = betAmount(body.bet);
  let auto = body.auto ? Math.round(Number(body.auto) * 100) : 0;
  if (auto && !(auto >= 101 && auto <= 100000)) throw bad('자동 회수는 1.01× ~ 1000×');
  await debit(u.id, amt);
  const ins = await q(`INSERT INTO crash_bets(round,user_id,nick,amount,auto) SELECT $1::bigint,$2,$3,$4::bigint,$5::int WHERE EXISTS (SELECT 1 FROM crash_rounds WHERE n=$1::bigint AND settled=0) ON CONFLICT (round,user_id) DO NOTHING RETURNING round`, [r.n, u.id, u.nick, amt, auto]);
  if (!ins.length) { await credit(u.id, amt); throw bad('이번 판에는 이미 탑승했어요.'); }
  return { ok: true, round: r.n, bal: await core.balanceOf(u.id) };
}
async function crashCashout(u) {
  const now = Date.now(), r = await crashCurrent(now);
  if (now < r.fly_at) throw bad('아직 이륙 전이에요.');
  if (now >= r.crash_at) throw bad('이미 폭발했어요!');
  const b = await one(`SELECT amount,auto,cashed FROM crash_bets WHERE round=$1 AND user_id=$2`, [r.n, u.id]);
  if (!b || num(b.cashed) !== 0) throw bad('회수할 베팅이 없어요.');
  let m = Math.round(crashMult(now - r.fly_at) * 100);
  const auto = num(b.auto); if (auto && auto < m) m = auto;
  if (m >= r.point) throw bad('이미 폭발했어요!');
  const pay = Math.floor(num(b.amount) * m / 100);
  const got = await q(`UPDATE crash_bets SET cashed=$3, payout=$4 WHERE round=$1 AND user_id=$2 AND cashed=0 RETURNING round`, [r.n, u.id, m, pay]);
  if (!got.length) throw bad('이미 처리됐어요.');
  await credit(u.id, pay);
  return { ok: true, mult: m / 100, payout: pay, bal: await core.balanceOf(u.id) };
}

// ================= LIVE BACCARAT =================
const BAC_BET_MS = 15000, BAC_SHOW_MS = 11000;
const BAC_SPOTS = { player: 2, banker: 1.95, tie: 9, ppair: 12, bpair: 12 };
function bacDeal() {
  const g = new S2.Baccarat(); g.shoe = C.deck(8);
  const r = g.play({});
  return { P: r.P, B: r.B, p: r.p, b: r.b, winner: r.winner, ppair: r.ppair, bpair: r.bpair };
}
function bacRow(r) { return r && { n: num(r.n), created: num(r.created), deal_at: num(r.deal_at), result: JSON.parse(r.result), settled: num(r.settled) }; }
async function bacCurrent(now) {
  let r = bacRow(await one(`SELECT * FROM bac_rounds ORDER BY n DESC LIMIT 1`));
  if (!r || now >= r.deal_at + BAC_SHOW_MS) {
    if (r && !r.settled) await bacSettle(r);
    const n = r ? r.n + 1 : 1;
    await q(`INSERT INTO bac_rounds(n,created,deal_at,result) VALUES($1,$2,$3,$4) ON CONFLICT (n) DO NOTHING`, [n, now, now + BAC_BET_MS, JSON.stringify(bacDeal())]);
    r = bacRow(await one(`SELECT * FROM bac_rounds ORDER BY n DESC LIMIT 1`));
    if (Math.random() < 0.05) q(`DELETE FROM bac_bets WHERE round < $1`, [r.n - 300]).then(() => q(`DELETE FROM bac_rounds WHERE n < $1`, [r.n - 300])).catch(() => {});
  }
  if (now >= r.deal_at + 1500 && !r.settled) await bacSettle(r);
  return r;
}
async function bacSettle(r) {
  const got = await q(`UPDATE bac_rounds SET settled=1 WHERE n=$1 AND settled=0 RETURNING n`, [r.n]);
  if (!got.length) return;
  const res = r.result, bets = await q(`SELECT user_id,spot,amount FROM bac_bets WHERE round=$1`, [r.n]);
  const per = {};
  for (const b of bets) {
    const amt = num(b.amount), s = b.spot; let ret = 0;
    if (s === 'player' || s === 'banker') ret = res.winner === s ? amt * BAC_SPOTS[s] : res.winner === 'tie' ? amt : 0;
    else if (s === 'tie') ret = res.winner === 'tie' ? amt * 9 : 0;
    else if (s === 'ppair') ret = res.ppair ? amt * 12 : 0;
    else if (s === 'bpair') ret = res.bpair ? amt * 12 : 0;
    ret = Math.floor(ret);
    await q(`UPDATE bac_bets SET payout=$4 WHERE round=$1 AND user_id=$2 AND spot=$3`, [r.n, b.user_id, s, ret]);
    const p = per[b.user_id] || (per[b.user_id] = { w: 0, p: 0 }); p.w += amt; p.p += ret;
  }
  const wn = { player: '플레이어', banker: '뱅커', tie: '타이' }[res.winner];
  for (const [uid, p] of Object.entries(per)) {
    if (p.p > 0) await credit(uid, p.p);
    await ledger(uid, 'bac', p.w, p.p, `#${r.n} ${wn} 승 ${res.p}:${res.b}`);
  }
}
async function bacState(u, since) {
  await core.assertGame('bac');
  const now = Date.now(), r = await bacCurrent(now);
  const dealt = now >= r.deal_at;
  const bets = await q(`SELECT user_id,nick,spot,amount,payout FROM bac_bets WHERE round=$1`, [r.n]);
  const road = await q(`SELECT n,result FROM bac_rounds WHERE deal_at<=$1 ORDER BY n DESC LIMIT 72`, [now]);
  const totals = { player: 0, banker: 0, tie: 0, ppair: 0, bpair: 0 }, players = {}, mine = {};
  for (const b of bets) {
    const a = num(b.amount); totals[b.spot] += a;
    const pl = players[b.user_id] || (players[b.user_id] = { nick: b.nick, uid: b.user_id, total: 0, spots: {}, payout: 0 });
    pl.total += a; pl.spots[b.spot] = a; pl.payout += num(b.payout);
    if (u && b.user_id === u.id) mine[b.spot] = a;
  }
  return {
    now, round: { n: r.n, created: r.created, dealAt: r.deal_at, nextAt: r.deal_at + BAC_SHOW_MS, phase: dealt ? 'deal' : 'bet', result: dealt ? r.result : null },
    totals, players: Object.values(players).sort((a, b) => b.total - a.total).slice(0, 30).map(p => dealt ? p : { ...p, payout: undefined }), mine,
    road: road.reverse().map(x => { const z = JSON.parse(x.result); return { w: z.winner, p: z.p, b: z.b, pp: z.ppair, bp: z.bpair }; }),
    reacts: await core.reactionsSince('bac', since || 0)
  };
}
async function bacBet(u, body) {
  await core.assertGame('bac');
  const now = Date.now(), r = await bacCurrent(now);
  if (now >= r.deal_at - 300) throw bad('베팅이 마감됐어요.');
  const spot = String(body.spot);
  if (!BAC_SPOTS[spot]) throw bad('없는 자리예요.');
  const amt = betAmount(body.amount);
  const cur = await one(`SELECT COALESCE(SUM(amount),0) AS s FROM bac_bets WHERE round=$1 AND user_id=$2`, [r.n, u.id]);
  if (num(cur.s) + amt > core.MAX_BET) throw bad('한 판 최대 100억G까지 걸 수 있어요.');
  if (spot === 'player' || spot === 'banker') {
    const other = await one(`SELECT amount FROM bac_bets WHERE round=$1 AND user_id=$2 AND spot=$3`, [r.n, u.id, spot === 'player' ? 'banker' : 'player']);
    if (other) throw bad('플레이어와 뱅커에 동시에 걸 수는 없어요.');
  }
  await debit(u.id, amt);
  const ins = await q(`INSERT INTO bac_bets(round,user_id,nick,spot,amount) SELECT $1::bigint,$2,$3,$4,$5::bigint WHERE EXISTS (SELECT 1 FROM bac_rounds WHERE n=$1::bigint AND settled=0)
     ON CONFLICT (round,user_id,spot) DO UPDATE SET amount=bac_bets.amount+EXCLUDED.amount RETURNING round`, [r.n, u.id, u.nick, spot, amt]);
  if (!ins.length) { await credit(u.id, amt); throw bad('베팅이 마감됐어요.'); }
  return { ok: true, bal: await core.balanceOf(u.id) };
}

module.exports = { crashState, crashBet, crashCashout, bacState, bacBet, CR_K };
