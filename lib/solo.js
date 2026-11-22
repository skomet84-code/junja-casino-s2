'use strict';
const crypto = require('node:crypto');
const S2 = require('./engine');
const C = require('./cards');
const core = require('./core');
const { q, one, num } = require('./db');
const { bad, betAmount, debit, credit, ledger } = core;

// ---- solo state helpers (optimistic concurrency) ----
async function load(uid, game) {
  const r = await one(`SELECT state,ver FROM solo WHERE user_id=$1 AND game=$2`, [uid, game]);
  return r ? { st: JSON.parse(r.state), ver: num(r.ver) } : { st: null, ver: -1 };
}
async function store(uid, game, st, ver) {
  const s = JSON.stringify(st);
  if (ver < 0) {
    const r = await q(`INSERT INTO solo(user_id,game,state,ver) VALUES($1,$2,$3,0) ON CONFLICT (user_id,game) DO NOTHING RETURNING ver`, [uid, game, s]);
    if (!r.length) throw bad('동시에 두 번 눌렸어요. 다시 시도해 주세요.');
    return;
  }
  const r = await q(`UPDATE solo SET state=$3, ver=ver+1 WHERE user_id=$1 AND game=$2 AND ver=$4 RETURNING ver`, [uid, game, s, ver]);
  if (!r.length) throw bad('동시에 두 번 눌렸어요. 다시 시도해 주세요.');
}
// debit, then commit state; refund if commit fails
async function debitAndStore(uid, amt, game, st, ver) {
  await debit(uid, amt);
  try { await store(uid, game, st, ver); } catch (e) { await credit(uid, amt); throw e; }
}
const rint = n => crypto.randomInt(0, n);

// ================= SLOT =================
async function slot(u, body) {
  await core.assertGame('slot');
  const { st, ver } = await load(u.id, 'slot');
  const free = st && st.freeLeft > 0;
  let bet, res, jp = 0;
  if (free) {
    bet = st.bet;
    res = S2.slotSpin(bet, { free: true });
    const next = { freeLeft: st.freeLeft - 1 + res.freeSpins, bet, total: st.total + res.total, startedFree: st.startedFree };
    await store(u.id, 'slot', next, ver);
    if (res.grand) jp = await core.jackpotTake(bet / 100000000);
    const pay = res.total + jp;
    if (pay > 0) await credit(u.id, pay);
    if (pay > 0) await ledger(u.id, 'slot', 0, pay, jp ? `GRAND JACKPOT ${jp} (프리스핀)` : `프리스핀 당첨`);
    return { ...view(res), free: true, freeLeft: next.freeLeft, freeTotal: next.total + jp, bet, jackpotWin: jp, payout: pay, jackpot: await core.jackpot(), bal: await core.balanceOf(u.id) };
  }
  if (body.comp) return compSpin(u, ver);
  bet = betAmount(body.bet);
  res = S2.slotSpin(bet);
  const next = res.freeSpins ? { freeLeft: res.freeSpins, bet, total: 0, startedFree: Date.now() } : { freeLeft: 0, bet, total: 0 };
  await debitAndStore(u.id, bet, 'slot', next, ver);
  await core.jackpotAdd(bet * 0.01);
  if (res.grand) jp = await core.jackpotTake(bet / 100000000);
  const pay = res.total + jp;
  if (pay > 0) await credit(u.id, pay);
  await ledger(u.id, 'slot', bet, pay, jp ? `GRAND JACKPOT ${jp}` : res.freeSpins ? `후광 · 프리스핀 ${res.freeSpins}회` : pay ? `${res.wins.length}라인 당첨` : '꽝');
  return { ...view(res), free: false, freeLeft: next.freeLeft, freeTotal: 0, bet, jackpotWin: jp, payout: pay, jackpot: await core.jackpot(), bal: await core.balanceOf(u.id) };
}
async function compSpin(u, ver) {
  const t = core.tierOf(u.bal), day = core.kstDay();
  if (!t.comp) throw bad('골드 하이롤러부터 받는 혜택이에요.');
  const got = await one(`UPDATE users SET comp_used = CASE WHEN comp_day=$2 THEN comp_used+1 ELSE 1 END, comp_day=$2
     WHERE id=$1 AND (comp_day<>$2 OR comp_used < $3::int) RETURNING comp_used`, [u.id, day, t.comp]);
  if (!got) throw bad('오늘의 컴프 스핀을 모두 사용했어요.');
  const bet = t.compBet, res = S2.slotSpin(bet);
  const next = res.freeSpins ? { freeLeft: res.freeSpins, bet, total: 0, startedFree: Date.now() } : { freeLeft: 0, bet, total: 0 };
  try { await store(u.id, 'slot', next, ver); } catch (e) { await q(`UPDATE users SET comp_used=GREATEST(0,comp_used-1) WHERE id=$1`, [u.id]); throw e; }
  let jp = 0; if (res.grand) jp = await core.jackpotTake(bet / 100000000);
  const pay = res.total + jp;
  if (pay > 0) await credit(u.id, pay);
  await ledger(u.id, 'slot', 0, pay, `컴프 스핀 (${core.TIERS[core.rankIdx(u.bal)].name}) · ${pay ? '당첨' : '꽝'}`);
  return { ...view(res), free: false, comp: true, compLeft: t.comp - num(got.comp_used), freeLeft: next.freeLeft, freeTotal: 0, bet, jackpotWin: jp, payout: pay, jackpot: await core.jackpot(), bal: await core.balanceOf(u.id) };
}
function view(res) { return { grid: res.grid, wins: res.wins, total: res.total, freeSpins: res.freeSpins, grand: res.grand }; }
async function slotState(u) { const { st } = await load(u.id, 'slot'); return { freeLeft: st ? st.freeLeft : 0, bet: st ? st.bet : 0, freeTotal: st ? st.total : 0, jackpot: await core.jackpot() }; }

// ================= PLINKO =================
async function plinko(u, body) {
  await core.assertGame('plinko');
  const bet = betAmount(body.bet), risk = ['low', 'mid', 'high'].includes(body.risk) ? body.risk : 'mid';
  const count = Math.max(1, Math.min(10, Math.floor(Number(body.count) || 1)));
  await debit(u.id, bet * count);
  const drops = []; let total = 0;
  for (let i = 0; i < count; i++) {
    const d = S2.plinkoDrop(), m = S2.PLINKO[risk][d.slot], pay = Math.floor(bet * m);
    total += pay; drops.push({ path: d.path, slot: d.slot, mult: m, payout: pay });
  }
  if (total > 0) await credit(u.id, total);
  for (const d of drops) await ledger(u.id, 'plinko', bet, d.payout, `${{ low: '안정', mid: '보통', high: '하이리스크' }[risk]} · ${d.mult}×`);
  return { drops, bet, risk, bal: await core.balanceOf(u.id) };
}

// ================= DICE =================
async function dice(u, body) {
  await core.assertGame('dice');
  const bet = betAmount(body.bet), over = !!body.over, t = Math.round(Number(body.target) * 100) / 100;
  if (!(t >= 1 && t <= 98)) throw bad('목표값은 1 ~ 98 사이로 정해 주세요.');
  const chance = over ? (99.99 - t) / 100 : t / 100;
  if (chance < 0.01 || chance > 0.97) throw bad('당첨 확률은 1% ~ 97% 사이여야 해요.');
  const mult = Math.floor(0.99 / chance * 10000) / 10000;
  await debit(u.id, bet);
  const roll = rint(10000) / 100;
  const win = over ? roll > t : roll < t;
  const pay = win ? Math.floor(bet * mult) : 0;
  if (pay) await credit(u.id, pay);
  await ledger(u.id, 'dice', bet, pay, `${roll.toFixed(2)} · ${over ? '오버' : '언더'} ${t} · ×${mult}`);
  return { roll, win, mult, payout: pay, bal: await core.balanceOf(u.id) };
}

// ================= BLACKJACK =================
class BJ extends S2.Blackjack { draw() { return C.randomCard(); } }
function bjRestore(st) { const g = Object.create(BJ.prototype); Object.assign(g, st); return g; }
function bjSave(g, wagered) { return { hands: g.hands, dealer: g.dealer, active: g.active, state: g.state, payout: g.payout || 0, wagered }; }
function bjView(st, revealAll) {
  const hide = st.state === 'play' && !revealAll;
  const dealer = hide ? [st.dealer[0], null] : st.dealer;
  return { state: st.state, hands: st.hands.map(h => ({ cards: h.cards, bet: h.bet, result: h.result || null, ret: h.ret || 0, score: S2.bjScore(h.cards) })),
    dealer, dealerScore: S2.bjScore(dealer.filter(Boolean)).total, active: st.active, payout: st.payout || 0, wagered: st.wagered,
    canDouble: st.state === 'play' && bjRestore(st).canDouble(), canSplit: st.state === 'play' && bjRestore(st).canSplit() };
}
async function bj(u, body) {
  await core.assertGame('bj');
  const { st, ver } = await load(u.id, 'bj');
  const a = body.action;
  if (a === 'state') return { game: st && st.state === 'play' ? bjView(st) : null };
  if (a === 'deal') {
    if (st && st.state === 'play') throw bad('진행 중인 판이 있어요.');
    const bet = betAmount(body.bet);
    const g = new BJ(); g.shoe = []; g.deal(bet);
    const s = bjSave(g, bet);
    await debitAndStore(u.id, bet, 'bj', s, ver);
    return finishBJ(u, s);
  }
  if (!st || st.state !== 'play') throw bad('진행 중인 판이 없어요.');
  const g = bjRestore(st); let extra = 0;
  if (a === 'hit') g.hit();
  else if (a === 'stand') g.stand();
  else if (a === 'double') { if (!g.canDouble()) throw bad('지금은 더블할 수 없어요.'); extra = g.hand.bet; g.double(); }
  else if (a === 'split') { if (!g.canSplit()) throw bad('지금은 스플릿할 수 없어요.'); extra = g.hand.bet; g.split(); }
  else throw bad('알 수 없는 동작');
  const s = bjSave(g, st.wagered + extra);
  if (extra) await debitAndStore(u.id, extra, 'bj', s, ver); else await store(u.id, 'bj', s, ver);
  return finishBJ(u, s);
}
async function finishBJ(u, s) {
  if (s.state === 'done') {
    if (s.payout > 0) await credit(u.id, s.payout);
    const r = s.hands.map(h => h.result);
    await ledger(u.id, 'bj', s.wagered, s.payout, (r.includes('blackjack') ? '블랙잭! ' : '') + r.map(x => ({ win: '승', lose: '패', bust: '버스트', push: '무', blackjack: 'BJ' }[x])).join('/') + ` · 딜러 ${S2.bjScore(s.dealer).total}`);
  }
  return { game: bjView(s), bal: await core.balanceOf(u.id) };
}

// ================= HI-LO =================
const HL_RK = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const hlCard = () => ({ v: rint(13) + 1, s: C.SUITS[rint(4)] });
const pHi = v => (14 - v) / 13, pLo = v => v / 13, fac = p => Math.floor(0.97 / p * 100) / 100;
function hlView(st) { return st ? { bet: st.bet, cur: st.cur, mult: st.mult, skips: st.skips, trail: st.trail, hi: st.cur.v === 1 ? 0 : fac(pHi(st.cur.v)), lo: st.cur.v === 13 ? 0 : fac(pLo(st.cur.v)) } : null; }
async function hilo(u, body) {
  await core.assertGame('hilo');
  const { st, ver } = await load(u.id, 'hilo');
  const live = st && st.live, a = body.action;
  if (a === 'state') return { game: live ? hlView(st) : null };
  if (a === 'start') {
    if (live) throw bad('진행 중인 판이 있어요.');
    const bet = betAmount(body.bet), cur = hlCard();
    const s = { live: true, bet, cur, mult: 1, skips: 0, trail: [cur] };
    await debitAndStore(u.id, bet, 'hilo', s, ver);
    return { game: hlView(s), bal: await core.balanceOf(u.id) };
  }
  if (!live) throw bad('진행 중인 판이 없어요.');
  if (a === 'skip') {
    if (st.skips >= 3) throw bad('넘기기는 3번까지예요.');
    const n = hlCard(); const s = { ...st, skips: st.skips + 1, cur: n, trail: [...st.trail, n] };
    await store(u.id, 'hilo', s, ver); return { game: hlView(s) };
  }
  if (a === 'cash') {
    if (st.mult <= 1) throw bad('한 번 이상 맞혀야 회수할 수 있어요.');
    await store(u.id, 'hilo', { live: false }, ver);
    const pay = Math.floor(st.bet * st.mult); await credit(u.id, pay);
    await ledger(u.id, 'hilo', st.bet, pay, `×${st.mult.toFixed(2)} 회수`);
    return { game: null, cashed: pay, mult: st.mult, bal: await core.balanceOf(u.id) };
  }
  if (a === 'hi' || a === 'lo') {
    const hi = a === 'hi', v = st.cur.v;
    if ((hi && v === 1) || (!hi && v === 13)) throw bad('확정된 선택은 할 수 없어요.');
    const n = hlCard(), ok = hi ? n.v >= v : n.v <= v;
    if (!ok) {
      await store(u.id, 'hilo', { live: false }, ver);
      await ledger(u.id, 'hilo', st.bet, 0, `실패 · ×${st.mult.toFixed(2)}에서 미끄러짐`);
      return { game: null, lost: true, card: n, trail: [...st.trail, n], mult: st.mult, bal: await core.balanceOf(u.id) };
    }
    const mult = Math.min(10000, Math.floor(st.mult * fac(hi ? pHi(v) : pLo(v)) * 100) / 100);
    const s = { ...st, cur: n, mult, trail: [...st.trail, n] };
    await store(u.id, 'hilo', s, ver);
    return { game: hlView(s), card: n };
  }
  throw bad('알 수 없는 동작');
}

// ================= MINES =================
function minesMult(m, k) { let x = 0.97; for (let i = 0; i < k; i++) x *= (25 - i) / (25 - m - i); return Math.floor(x * 100) / 100; }
function minesView(st) { return st && st.live ? { bet: st.bet, m: st.m, picked: st.picked, mult: minesMult(st.m, st.picked.length), next: minesMult(st.m, st.picked.length + 1) } : null; }
async function mines(u, body) {
  await core.assertGame('mines');
  const { st, ver } = await load(u.id, 'mines');
  const live = st && st.live, a = body.action;
  if (a === 'state') return { game: minesView(st) };
  if (a === 'start') {
    if (live) throw bad('진행 중인 판이 있어요.');
    const bet = betAmount(body.bet), m = Math.floor(Number(body.mines));
    if (!(m >= 1 && m <= 24)) throw bad('지뢰는 1~24개');
    const cells = C.shuffle([...Array(25).keys()]).slice(0, m);
    const s = { live: true, bet, m, mines: cells, picked: [] };
    await debitAndStore(u.id, bet, 'mines', s, ver);
    return { game: minesView(s), bal: await core.balanceOf(u.id) };
  }
  if (!live) throw bad('진행 중인 판이 없어요.');
  if (a === 'pick') {
    const i = Math.floor(Number(body.cell));
    if (!(i >= 0 && i < 25) || st.picked.includes(i)) throw bad('이미 열었거나 없는 칸이에요.');
    if (st.mines.includes(i)) {
      await store(u.id, 'mines', { live: false }, ver);
      await ledger(u.id, 'mines', st.bet, 0, `지뢰 ${st.m}개 · ${st.picked.length}칸 후 폭발`);
      return { game: null, boom: i, mines: st.mines, picked: st.picked, bal: await core.balanceOf(u.id) };
    }
    const s = { ...st, picked: [...st.picked, i] };
    if (s.picked.length === 25 - st.m) { // cleared
      await store(u.id, 'mines', { live: false }, ver);
      const mult = minesMult(st.m, s.picked.length), pay = Math.floor(st.bet * mult);
      await credit(u.id, pay); await ledger(u.id, 'mines', st.bet, pay, `지뢰 ${st.m}개 · 전부 클리어 ×${mult}`);
      return { game: null, cleared: true, cashed: pay, mult, mines: st.mines, picked: s.picked, bal: await core.balanceOf(u.id) };
    }
    await store(u.id, 'mines', s, ver);
    return { game: minesView(s), safe: i };
  }
  if (a === 'cash') {
    if (!st.picked.length) throw bad('한 칸 이상 열어야 회수할 수 있어요.');
    await store(u.id, 'mines', { live: false }, ver);
    const mult = minesMult(st.m, st.picked.length), pay = Math.floor(st.bet * mult);
    await credit(u.id, pay); await ledger(u.id, 'mines', st.bet, pay, `지뢰 ${st.m}개 · ${st.picked.length}칸 ×${mult} 회수`);
    return { game: null, cashed: pay, mult, mines: st.mines, picked: st.picked, bal: await core.balanceOf(u.id) };
  }
  throw bad('알 수 없는 동작');
}

// ================= VIDEO POKER =================
async function vpoker(u, body) {
  await core.assertGame('vpoker');
  const { st, ver } = await load(u.id, 'vpoker');
  const live = st && st.live, a = body.action;
  if (a === 'state') return { game: live ? { bet: st.bet, hand: st.hand } : null };
  if (a === 'deal') {
    if (live) throw bad('진행 중인 판이 있어요.');
    const bet = betAmount(body.bet), d = C.deck();
    const s = { live: true, bet, hand: d.slice(0, 5), rest: d.slice(5, 10) };
    await debitAndStore(u.id, bet, 'vpoker', s, ver);
    const hint = C.vpEval(s.hand);
    return { game: { bet, hand: s.hand }, hint: hint >= 0 ? C.VP_PAY[hint][0] : null, bal: await core.balanceOf(u.id) };
  }
  if (a === 'draw') {
    if (!live) throw bad('진행 중인 판이 없어요.');
    const holds = Array.isArray(body.holds) ? body.holds.map(Boolean).slice(0, 5) : [];
    let k = 0; const hand = st.hand.map((c, i) => holds[i] ? c : st.rest[k++]);
    await store(u.id, 'vpoker', { live: false }, ver);
    const r = C.vpEval(hand), mult = r >= 0 ? C.VP_PAY[r][1] : 0, pay = st.bet * mult;
    if (pay) await credit(u.id, pay);
    await ledger(u.id, 'vpoker', st.bet, pay, r >= 0 ? `${C.VP_PAY[r][0]} ×${mult}` : '노 핸드');
    return { hand, result: r >= 0 ? C.VP_PAY[r][0] : null, rank: r, mult, payout: pay, bal: await core.balanceOf(u.id) };
  }
  throw bad('알 수 없는 동작');
}

module.exports = { slot, slotState, plinko, dice, bj, hilo, mines, vpoker, minesMult };
