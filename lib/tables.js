'use strict';
// Player-vs-player tables (Texas Hold'em, Seotda). State lives in one JSON row per table,
// advanced lazily and committed with optimistic versioning. Money moves only through
// effects executed after a successful commit.
const C = require('./cards');
const core = require('./core');
const { q, one, num } = require('./db');
const { bad } = core;

const ACT_MS = 20000, SHOW_MS = 6500, FOLD_SHOW_MS = 3000, START_MS = 3000;
const TABLES = {
  h1: { game: 'holdem', name: '루키 라운지', sb: 10000, bb: 20000, min: 400000, max: 2000000 },
  h2: { game: 'holdem', name: '골드 살롱', sb: 1000000, bb: 2000000, min: 40000000, max: 200000000 },
  h3: { game: 'holdem', name: '셀레스티아 VIP', sb: 100000000, bb: 200000000, min: 4000000000, max: 20000000000, minTier: 3 },
  s1: { game: 'seotda', name: '동네 한 판', ante: 10000, min: 500000, max: 5000000 },
  s2: { game: 'seotda', name: '강남 하우스', ante: 1000000, min: 50000000, max: 500000000 },
  s3: { game: 'seotda', name: '하늘 위의 판', ante: 100000000, min: 5000000000, max: 50000000000, minTier: 3 }
};
const SEATS = 6;

function emptyState(id) { return { id, seats: Array(SEATS).fill(null), phase: 'wait', hand: null, handNo: 0, dealer: -1, nextAt: 0, last: null, log: [] }; }

async function loadTable(id) {
  if (!TABLES[id]) throw bad('없는 테이블이에요.');
  let r = await one(`SELECT state,ver FROM tables WHERE id=$1`, [id]);
  if (!r) {
    await q(`INSERT INTO tables(id,game,state,ver,updated) VALUES($1,$2,$3,0,$4) ON CONFLICT (id) DO NOTHING`, [id, TABLES[id].game, JSON.stringify(emptyState(id)), Date.now()]);
    r = await one(`SELECT state,ver FROM tables WHERE id=$1`, [id]);
  }
  return { st: JSON.parse(r.state), ver: num(r.ver) };
}
async function commit(id, st, ver) {
  const r = await q(`UPDATE tables SET state=$2, ver=ver+1, updated=$4 WHERE id=$1 AND ver=$3 RETURNING ver`, [id, JSON.stringify(st), ver, Date.now()]);
  return r.length > 0;
}
async function runEffects(effects) {
  for (const e of effects) {
    if (e.t === 'credit' && e.amt > 0) await core.credit(e.uid, e.amt);
    if (e.t === 'ledger') await core.ledger(e.uid, e.game, e.wager, e.payout, e.note);
  }
}
// mutate(st, now, effects) -> returns value or throws; tick is applied first
async function withTable(id, mutate, opts = {}) {
  for (let i = 0; i < 5; i++) {
    const { st, ver } = await loadTable(id);
    const now = Date.now(), effects = [];
    const before = JSON.stringify(st);
    tick(st, now, effects);
    let out;
    if (mutate) out = mutate(st, now, effects);
    tick(st, now, effects);
    if (JSON.stringify(st) === before && !effects.length) return { st, out };
    if (opts.preDebit && i === 0) { /* handled by caller */ }
    if (await commit(id, st, ver)) { await runEffects(effects); return { st, out }; }
  }
  throw bad('테이블이 붐벼요. 다시 시도해 주세요.');
}

// ---------- generic helpers ----------
const cfgOf = st => TABLES[st.id];
const occupied = st => st.seats.map((s, i) => s ? i : -1).filter(i => i >= 0);
function nextIdx(st, from, pred) { for (let k = 1; k <= SEATS; k++) { const i = (from + k) % SEATS; if (st.seats[i] && pred(st.seats[i], i)) return i; } return -1; }
const inHand = s => s && s.inHand;
const live = s => s && s.inHand && !s.folded;
const canAct = s => live(s) && !s.allin;
function potTotal(st) { return st.seats.reduce((a, s) => a + (s && s.inHand ? s.total + s.bet : 0), 0) + (st.hand ? st.hand.carry || 0 : 0); }
function log(st, msg) { st.log.push(msg); if (st.log.length > 12) st.log.splice(0, st.log.length - 12); }

function tick(st, now, effects) {
  const cfg = cfgOf(st);
  for (let guard = 0; guard < 30; guard++) {
    if (st.phase === 'play') {
      const h = st.hand, s = st.seats[h.toAct];
      if (!s || !canAct(s)) { advance(st, now, effects); continue; }
      if (s.leave) { doAction(st, h.toAct, { type: 'fold' }, now, true); advance(st, now, effects); continue; }
      if (now > h.deadline) {
        const toCall = h.curBet - s.bet;
        s.missed = (s.missed || 0) + 1; if (s.missed >= 2) s.leave = true;
        doAction(st, h.toAct, { type: toCall > 0 ? 'fold' : 'check' }, h.deadline, true);
        log(st, `${s.nick} 시간 초과`);
        advance(st, now, effects); continue;
      }
      return;
    }
    if (st.phase === 'show') {
      if (now < st.nextAt) return;
      cleanup(st, effects);
      st.phase = 'wait'; st.hand = null; st.nextAt = now + START_MS;
      continue;
    }
    if (st.phase === 'wait') {
      cleanup(st, effects);
      const ready = occupied(st).filter(i => eligible(st, st.seats[i]));
      if (ready.length < 2) { st.nextAt = 0; return; }
      if (!st.nextAt) { st.nextAt = now + START_MS; return; }
      if (now < st.nextAt) return;
      (cfg.game === 'holdem' ? startHoldem : startSeotda)(st, now);
      continue;
    }
    return;
  }
}
function eligible(st, s) { const c = cfgOf(st); return s && !s.leave && s.stack >= (c.game === 'holdem' ? c.bb : c.ante); }
function cleanup(st, effects) {
  st.seats.forEach((s, i) => {
    if (!s) return;
    const c = cfgOf(st);
    const broke = s.stack < (c.game === 'holdem' ? c.bb : c.ante);
    if (s.leave || broke) {
      if (s.stack > 0) effects.push({ t: 'credit', uid: s.uid, amt: s.stack });
      st.seats[i] = null;
    }
  });
}
function resetSeat(s) { s.inHand = false; s.folded = false; s.allin = false; s.bet = 0; s.total = 0; s.acted = false; s.cards = []; s.show = false; s.won = 0; s.handName = ''; }

// ---------- betting ----------
function doAction(st, i, a, now, auto) {
  const h = st.hand, s = st.seats[i];
  if (!s || h.toAct !== i || !canAct(s)) throw bad('지금은 당신 차례가 아니에요.');
  const toCall = h.curBet - s.bet;
  const pay = amt => { amt = Math.min(amt, s.stack); s.stack -= amt; s.bet += amt; if (s.stack === 0) s.allin = true; return amt; };
  const raiseTo = target => {
    target = Math.floor(target);
    const max = s.bet + s.stack;
    if (target > max) target = max;
    if (target <= h.curBet) { pay(toCall); return 'call'; }
    const inc = target - h.curBet;
    if (inc < h.minRaise && target < max) throw bad(`최소 ${core_fmt(h.curBet + h.minRaise)}까지 올려야 해요.`);
    pay(target - s.bet);
    if (inc >= h.minRaise) h.minRaise = inc;
    h.curBet = target;
    st.seats.forEach((o, k) => { if (k !== i && canAct(o)) o.acted = false; });
    return 'raise';
  };
  let label;
  switch (a.type) {
    case 'fold': s.folded = true; label = cfgOf(st).game === 'seotda' ? '다이' : '폴드'; break;
    case 'check': if (toCall > 0) throw bad('콜 금액이 있어서 체크할 수 없어요.'); label = '체크'; break;
    case 'call': if (toCall <= 0) { label = '체크'; break; } pay(toCall); label = s.allin ? '올인 콜' : '콜'; break;
    case 'raise': { const r = raiseTo(Number(a.amount)); label = r === 'call' ? '콜' : (s.allin ? '올인' : `레이즈 ${core_fmt(h.curBet)}`); break; }
    case 'allin': { const r = raiseTo(s.bet + s.stack); label = r === 'call' ? '올인 콜' : '올인'; break; }
    // seotda presets
    case 'bbing': { const c = cfgOf(st); const r = raiseTo(Math.max(h.curBet, 0) + c.ante); label = r === 'call' ? '콜' : '삥'; break; }
    case 'half': { const pot = potTotal(st); const r = raiseTo(h.curBet + Math.max(cfgOf(st).ante, Math.floor((pot + toCall) / 2))); label = r === 'call' ? '콜' : (s.allin ? '올인' : '하프'); break; }
    case 'ddadang': { const r = raiseTo(Math.max(h.curBet * 2, cfgOf(st).ante * 2)); label = r === 'call' ? '콜' : (s.allin ? '올인' : '따당'); break; }
    default: throw bad('알 수 없는 동작');
  }
  if (!auto) s.missed = 0;
  s.acted = true; s.lastAct = label; h.lastAction = { seat: i, label, at: now };
  log(st, `${s.nick} ${label}`);
}
function core_fmt(n) { return n >= 1e8 ? (n / 1e8) + '억' : n >= 1e4 ? (n / 1e4) + '만' : String(n); }

function roundDone(st) {
  const h = st.hand, actors = st.seats.filter(canAct);
  if (actors.length === 0) return true;
  if (actors.length === 1) return actors[0].bet >= maxBet(st) && (actors[0].acted || st.seats.filter(live).length > 1);
  return actors.every(s => s.acted && s.bet === h.curBet);
}
const maxBet = st => Math.max(0, ...st.seats.filter(live).map(s => s.bet));
function collect(st) { st.seats.forEach(s => { if (s && s.inHand) { s.total += s.bet; s.bet = 0; s.acted = false; } }); st.hand.curBet = 0; }

function advance(st, now, effects) {
  const h = st.hand, g = cfgOf(st).game;
  const alive = st.seats.map((s, i) => live(s) ? i : -1).filter(i => i >= 0);
  if (alive.length === 1) { collect(st); return finishFold(st, alive[0], now, effects); }
  if (!roundDone(st)) {
    const nx = nextIdx(st, h.toAct, s => canAct(s) && !(s.acted && s.bet === h.curBet));
    h.toAct = nx; h.deadline = now + ACT_MS; return;
  }
  collect(st);
  if (g === 'seotda') return showdown(st, now, effects);
  const deal = n => { for (let k = 0; k < n; k++) h.board.push(h.deck.pop()); };
  const streets = ['pre', 'flop', 'turn', 'river'];
  while (true) {
    const idx = streets.indexOf(h.street);
    if (idx === 3) return showdown(st, now, effects);
    h.street = streets[idx + 1]; deal(h.street === 'flop' ? 3 : 1);
    h.minRaise = cfgOf(st).bb;
    const actors = st.seats.filter(canAct);
    if (actors.length >= 2) { h.toAct = nextIdx(st, st.dealer, canAct); h.deadline = now + ACT_MS; return; }
  }
}
function finishFold(st, w, now, effects) {
  const pot = potTotal(st), s = st.seats[w];
  s.stack += pot; s.won = pot;
  log(st, `${s.nick} 승리 · ${core_fmt(pot)}`);
  st.last = { winners: [{ seat: w, nick: s.nick, amount: pot, hand: '' }], fold: true, pot };
  endHand(st, now + FOLD_SHOW_MS, effects);
}
function endHand(st, until, effects) {
  const g = cfgOf(st).game;
  st.seats.forEach(s => { if (s && s.inHand) effects.push({ t: 'ledger', uid: s.uid, game: g, wager: s.total, payout: s.won || 0, note: `${cfgOf(st).name} #${st.handNo}${s.handName ? ' · ' + s.handName : ''}` }); });
  st.phase = 'show'; st.nextAt = until; st.hand.toAct = -1;
}
function pots(st) {
  // side pots from total contributions
  const contrib = st.seats.map((s, i) => s && s.inHand ? { i, amt: s.total, live: !s.folded } : null).filter(Boolean);
  const levels = [...new Set(contrib.filter(c => c.live).map(c => c.amt))].sort((a, b) => a - b);
  const res = []; let prev = 0;
  for (const L of levels) {
    let amount = 0; contrib.forEach(c => { amount += Math.max(0, Math.min(c.amt, L) - prev); });
    const elig = contrib.filter(c => c.live && c.amt >= L).map(c => c.i);
    if (amount > 0) res.push({ amount, elig });
    prev = L;
  }
  // contributions above the highest live level (folded overbets) go to the last pot
  const extra = contrib.reduce((a, c) => a + Math.max(0, c.amt - prev), 0);
  if (extra && res.length) res[res.length - 1].amount += extra;
  if (st.hand.carry && res.length) res[0].amount += st.hand.carry;
  return res;
}
function showdown(st, now, effects) {
  const g = cfgOf(st).game, h = st.hand;
  const alive = st.seats.map((s, i) => live(s) ? i : -1).filter(i => i >= 0);
  alive.forEach(i => { st.seats[i].show = true; });
  if (g === 'holdem') {
    alive.forEach(i => { const s = st.seats[i]; const b = C.bestHand([...s.cards, ...h.board]); s.score = b.score; s.handName = b.name; s.best = b.cards; });
  } else {
    alive.forEach(i => { const s = st.seats[i]; const r = C.seotdaRank(s.cards[0], s.cards[1]); s.rank = r; s.handName = r.name; });
    // 구사 재경기
    const gusa = alive.find(i => st.seats[i].rank.special === 'gusa'), mgusa = alive.find(i => st.seats[i].rank.special === 'mgusa');
    const othersTop = k => Math.max(...alive.filter(i => i !== k).map(i => effectiveV(st.seats[i].rank)));
    if ((mgusa !== undefined && othersTop(mgusa) <= 810) || (gusa !== undefined && othersTop(gusa) <= 700)) {
      // refund every contribution and replay
      st.seats.forEach(s => { if (s && s.inHand) { s.stack += s.total; s.total = 0; } });
      const who = st.seats[mgusa !== undefined ? mgusa : gusa];
      log(st, `${who.nick} ${who.handName}! 재경기`);
      st.last = { replay: true, by: who.nick, name: who.handName, reveal: alive.map(i => ({ seat: i, cards: st.seats[i].cards, name: st.seats[i].handName })) };
      st.seats.forEach(s => { if (s && s.inHand) s.handName = '재경기'; });
      st.phase = 'show'; st.nextAt = now + SHOW_MS; h.toAct = -1;
      return;
    }
  }
  const winnersAll = [];
  for (const p of pots(st)) {
    const w = g === 'holdem' ? holdemWinners(st, p.elig) : seotdaWinners(st, p.elig);
    const share = Math.floor(p.amount / w.length); let rem = p.amount - share * w.length;
    w.forEach(i => { const s = st.seats[i]; const amt = share + (rem > 0 ? rem : 0); rem = 0; s.stack += amt; s.won = (s.won || 0) + amt; });
    w.forEach(i => winnersAll.push(i));
  }
  const uniq = [...new Set(winnersAll)];
  st.last = { winners: uniq.map(i => ({ seat: i, nick: st.seats[i].nick, amount: st.seats[i].won, hand: st.seats[i].handName })), pot: uniq.reduce((a, i) => a + st.seats[i].won, 0),
    reveal: alive.map(i => ({ seat: i, cards: st.seats[i].cards, name: st.seats[i].handName, best: st.seats[i].best || null })) };
  log(st, uniq.map(i => `${st.seats[i].nick} ${st.seats[i].handName} 승`).join(', '));
  endHand(st, now + SHOW_MS, effects);
}
function holdemWinners(st, elig) {
  let best = null, w = [];
  elig.forEach(i => { const sc = st.seats[i].score; const c = best ? C.cmp(sc, best) : 1; if (c > 0) { best = sc; w = [i]; } else if (c === 0) w.push(i); });
  return w;
}
const effectiveV = r => r.v;
function seotdaWinners(st, elig) {
  const R = i => st.seats[i].rank;
  const top = Math.max(...elig.map(i => R(i).v));
  if (top >= 801 && top <= 809) { const tj = elig.filter(i => R(i).special === 'ttaengjab'); if (tj.length) return tj; }
  if (top === 900) { const am = elig.filter(i => R(i).special === 'amhaeng'); if (am.length) return am; }
  return elig.filter(i => R(i).v === top);
}

// ---------- hand start ----------
function seatPlayers(st) {
  const ps = occupied(st).filter(i => eligible(st, st.seats[i]));
  st.seats.forEach(s => { if (s) resetSeat(s); });
  ps.forEach(i => { st.seats[i].inHand = true; });
  return ps;
}
function startHoldem(st, now) {
  const c = cfgOf(st), ps = seatPlayers(st);
  st.handNo++; st.last = null;
  st.dealer = nextIdx(st, st.dealer < 0 ? -1 : st.dealer, s => s.inHand);
  const heads = ps.length === 2;
  const sb = heads ? st.dealer : nextIdx(st, st.dealer, s => s.inHand);
  const bb = nextIdx(st, sb, s => s.inHand);
  const deck = C.deck();
  st.hand = { street: 'pre', board: [], deck, curBet: 0, minRaise: c.bb, toAct: -1, deadline: 0, sb, bb, lastAction: null };
  const post = (i, amt) => { const s = st.seats[i]; const a = Math.min(amt, s.stack); s.stack -= a; s.bet += a; if (!s.stack) s.allin = true; };
  post(sb, c.sb); post(bb, c.bb);
  st.hand.curBet = c.bb;
  for (let r = 0; r < 2; r++) ps.forEach(i => st.seats[i].cards.push(deck.pop()));
  st.phase = 'play';
  st.hand.toAct = heads ? sb : nextIdx(st, bb, s => s.inHand);
  if (!canAct(st.seats[st.hand.toAct])) st.hand.toAct = nextIdx(st, st.hand.toAct, canAct);
  st.hand.deadline = now + ACT_MS;
  log(st, `#${st.handNo} 시작 · 블라인드 ${core_fmt(c.sb)}/${core_fmt(c.bb)}`);
}
function startSeotda(st, now) {
  const c = cfgOf(st), ps = seatPlayers(st);
  st.handNo++; st.last = null;
  st.dealer = nextIdx(st, st.dealer < 0 ? -1 : st.dealer, s => s.inHand);
  const deck = C.hwatuDeck();
  st.hand = { street: 'bet', board: [], deck, curBet: 0, minRaise: c.ante, toAct: -1, deadline: 0, carry: 0, lastAction: null };
  ps.forEach(i => { const s = st.seats[i]; const a = Math.min(c.ante, s.stack); s.stack -= a; s.total += a; if (!s.stack) s.allin = true; });
  for (let r = 0; r < 2; r++) ps.forEach(i => st.seats[i].cards.push(deck.pop()));
  st.phase = 'play';
  st.hand.toAct = nextIdx(st, st.dealer, canAct);
  st.hand.deadline = now + ACT_MS;
  log(st, `#${st.handNo} 시작 · 앤티 ${core_fmt(c.ante)}`);
}

// ---------- API ----------
function view(st, u, now) {
  const c = cfgOf(st), h = st.hand;
  const mySeat = u ? st.seats.findIndex(s => s && s.uid === u.id) : -1;
  const seats = st.seats.map((s, i) => s && {
    nick: s.nick, uid: s.uid, avatar: s.avatar || 0, tier: s.tier || 0, stack: s.stack, bet: s.bet, total: s.total, inHand: !!s.inHand, folded: !!s.folded, allin: !!s.allin,
    leave: !!s.leave, lastAct: s.lastAct || '', won: s.won || 0, handName: (s.show || i === mySeat) ? s.handName || '' : '',
    cards: s.inHand ? ((i === mySeat || s.show) ? s.cards : s.cards.map(() => null)) : [],
    best: s.show && s.best ? s.best : null,
    myRank: i === mySeat && c.game === 'seotda' && s.cards && s.cards.length === 2 ? C.seotdaRank(s.cards[0], s.cards[1]).name : undefined,
    myHand: i === mySeat && c.game === 'holdem' && s.cards && s.cards.length === 2 && h && h.board && h.board.length >= 3 ? C.bestHand([...s.cards, ...h.board]).name : undefined
  });
  let me = null;
  if (mySeat >= 0 && st.phase === 'play' && h && h.toAct === mySeat) {
    const s = st.seats[mySeat], toCall = Math.max(0, h.curBet - s.bet);
    me = { turn: true, toCall: Math.min(toCall, s.stack), minRaiseTo: Math.min(h.curBet + h.minRaise, s.bet + s.stack), maxRaiseTo: s.bet + s.stack, pot: potTotal(st), curBet: h.curBet, myBet: s.bet };
  }
  return {
    now, id: st.id, game: c.game, name: c.name, cfg: { sb: c.sb, bb: c.bb, ante: c.ante, min: c.min, max: c.max, minTier: c.minTier || 0 },
    phase: st.phase, handNo: st.handNo, dealer: st.dealer, seats, mySeat, me,
    board: h && c.game === 'holdem' ? h.board : [], pot: h ? potTotal(st) : 0, toAct: h ? h.toAct : -1, deadline: h ? h.deadline : 0,
    street: h ? h.street : '', nextAt: st.nextAt, last: st.last, log: st.log.slice(-8), actMs: ACT_MS
  };
}
async function state(u, id, since) {
  await core.assertGame(TABLES[id] ? TABLES[id].game : 'x');
  const { st } = await withTable(id, null);
  return { ...view(st, u, Date.now()), reacts: await core.reactionsSince('t:' + id, since || 0) };
}
async function sit(u, id, body) {
  const c = TABLES[id]; if (!c) throw bad('없는 테이블');
  await core.assertGame(c.game);
  if (c.minTier && core.rankIdx(u.bal) < c.minTier) throw bad(`${core.TIERS[c.minTier].name} 이상만 앉을 수 있는 VIP 테이블이에요.`);
  const buyin = Math.floor(Number(body.buyin));
  if (!(buyin >= c.min && buyin <= c.max)) throw bad(`바이인은 ${core_fmt(c.min)} ~ ${core_fmt(c.max)}G`);
  const seat = Math.floor(Number(body.seat));
  if (!(seat >= 0 && seat < SEATS)) throw bad('자리를 골라 주세요.');
  await core.debit(u.id, buyin);
  try {
    const { st } = await withTable(id, (st) => {
      if (st.seats.some(s => s && s.uid === u.id)) throw bad('이미 앉아 있어요.');
      if (st.seats[seat]) throw bad('이미 누가 앉은 자리예요.');
      st.seats[seat] = { uid: u.id, nick: u.nick, avatar: u.avatar, tier: core.rankIdx(u.bal), stack: buyin, missed: 0 }; resetSeat(st.seats[seat]);
      log(st, `${u.nick} 착석`);
    });
    return { ...view(st, u, Date.now()), bal: await core.balanceOf(u.id) };
  } catch (e) { await core.credit(u.id, buyin); throw e; }
}
async function leave(u, id) {
  const { st } = await withTable(id, (st, now, effects) => {
    const i = st.seats.findIndex(s => s && s.uid === u.id);
    if (i < 0) throw bad('앉아 있지 않아요.');
    const s = st.seats[i];
    if (st.phase === 'play' && live(s)) { s.leave = true; if (st.hand.toAct === i) { doAction(st, i, { type: 'fold' }, now, true); advance(st, now, effects); } log(st, `${s.nick} 이번 판 후 퇴장`); }
    else if (st.phase === 'show' && s.inHand) { s.leave = true; }
    else { if (s.stack > 0) effects.push({ t: 'credit', uid: s.uid, amt: s.stack }); st.seats[i] = null; log(st, `${s.nick} 퇴장`); }
  });
  return { ...view(st, u, Date.now()), bal: await core.balanceOf(u.id) };
}
async function act(u, id, body) {
  const { st } = await withTable(id, (st, now, effects) => {
    const i = st.seats.findIndex(s => s && s.uid === u.id);
    if (i < 0 || st.phase !== 'play') throw bad('지금은 행동할 수 없어요.');
    doAction(st, i, { type: String(body.type), amount: body.amount }, now, false);
    advance(st, now, effects);
  });
  return view(st, u, Date.now());
}
async function lobby() {
  const rows = await q(`SELECT id,state FROM tables`);
  const map = Object.fromEntries(rows.map(r => [r.id, JSON.parse(r.state)]));
  return Object.entries(TABLES).map(([id, c]) => {
    const st = map[id]; const seated = st ? st.seats.filter(Boolean) : [];
    return { id, game: c.game, name: c.name, minTier: c.minTier || 0, sb: c.sb, bb: c.bb, ante: c.ante, min: c.min, max: c.max, players: seated.length, nicks: seated.map(s => s.nick), seats: SEATS };
  });
}
// admin: refund everything at a table and clear it
async function adminReset(id) {
  const { st, ver } = await loadTable(id);
  const effects = [];
  st.seats.forEach(s => { if (s) effects.push({ t: 'credit', uid: s.uid, amt: s.stack + (s.inHand ? s.bet + s.total : 0) }); });
  if (!(await commit(id, emptyState(id), ver))) throw bad('다시 시도');
  await runEffects(effects);
  return effects.length;
}

module.exports = { TABLES, state, sit, leave, act, lobby, adminReset, _test: { tick, doAction, advance, emptyState, pots } };
