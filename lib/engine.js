/* JUNJA LAND CASINO · SEASON 2 "CELESTIA" — pure game engines (no DOM) */
const S2 = (() => {
  'use strict';
  // ---------- RNG ----------
  let rngImpl = null;
  function rand() {
    if (rngImpl) return rngImpl();
    const a = new Uint32Array(2);
    (globalThis.crypto || require('crypto').webcrypto).getRandomValues(a);
    return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53;
  }
  const setRng = f => { rngImpl = f; };
  const randInt = n => Math.floor(rand() * n);
  function pickWeighted(list) {
    let t = 0; for (const x of list) t += x.w;
    let r = rand() * t;
    for (const x of list) { if ((r -= x.w) < 0) return x; }
    return list[list.length - 1];
  }

  // ---------- SLOT: HEAVEN REELS (5x3, 10 lines) ----------
  const SLOT = {
    reels: 5, rows: 3,
    symbols: {
      J:  { name: 'JUNJA WILD', pay: [0, 0, 0, 30, 150, 2000], wild: true },
      S7: { name: 'SEVEN', pay: [0, 0, 0, 50, 200, 1000] },
      CR: { name: 'CROWN', pay: [0, 0, 0, 25, 100, 500] },
      DI: { name: 'DIAMOND', pay: [0, 0, 0, 20, 60, 250] },
      MO: { name: 'MOON', pay: [0, 0, 0, 12, 35, 140] },
      A:  { name: 'A', pay: [0, 0, 0, 7, 18, 70] },
      K:  { name: 'K', pay: [0, 0, 0, 5, 14, 55] },
      Q:  { name: 'Q', pay: [0, 0, 0, 2, 10, 45] },
      SC: { name: 'HALO', scatter: true }
    },
    // per-reel weights
    weights: [
      { J: 3, S7: 3, CR: 5, DI: 7, MO: 10, A: 14, K: 16, Q: 18, SC: 3 },
      { J: 4, S7: 3, CR: 5, DI: 7, MO: 10, A: 14, K: 16, Q: 18, SC: 3 },
      { J: 4, S7: 3, CR: 5, DI: 7, MO: 10, A: 14, K: 16, Q: 18, SC: 3 },
      { J: 4, S7: 3, CR: 5, DI: 7, MO: 10, A: 14, K: 16, Q: 18, SC: 3 },
      { J: 3, S7: 3, CR: 5, DI: 7, MO: 10, A: 14, K: 16, Q: 18, SC: 3 }
    ],
    lines: [
      [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
      [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1]
    ],
    scatterPay: { 3: 2, 4: 10, 5: 50 },   // x total bet
    scatterSpins: { 3: 8, 4: 10, 5: 15 },
    freeMult: 2,
    grandKey: 'J'                         // 5 wilds on a line = GRAND
  };
  SLOT.reelLists = SLOT.weights.map(w => Object.entries(w).filter(([, v]) => v > 0).map(([k, v]) => ({ k, w: v })));

  function slotSpin(totalBet, opts = {}) {
    const lineBet = totalBet / SLOT.lines.length;
    const grid = [];
    for (let r = 0; r < SLOT.reels; r++) {
      const col = [];
      for (let y = 0; y < SLOT.rows; y++) col.push(pickWeighted(SLOT.reelLists[r]).k);
      grid.push(col);
    }
    return { grid, ...slotEvaluate(grid, lineBet, totalBet, opts) };
  }
  function slotEvaluate(grid, lineBet, totalBet, opts = {}) {
    const mult = opts.free ? SLOT.freeMult : 1;
    const wins = []; let total = 0; let grand = false;
    SLOT.lines.forEach((line, li) => {
      const syms = line.map((y, r) => grid[r][y]);
      // wild-run pay
      let wRun = 0; while (wRun < 5 && syms[wRun] === 'J') wRun++;
      const wildPay = SLOT.symbols.J.pay[wRun] || 0;
      // substituted pay
      const base = syms.find(s => s !== 'J');
      let subPay = 0, subRun = 0;
      if (base && !SLOT.symbols[base].scatter) {
        while (subRun < 5 && (syms[subRun] === base || syms[subRun] === 'J')) subRun++;
        subPay = SLOT.symbols[base].pay[subRun] || 0;
      }
      let pay = 0, sym = null, count = 0;
      if (wildPay >= subPay && wildPay > 0) { pay = wildPay; sym = 'J'; count = wRun; }
      else if (subPay > 0) { pay = subPay; sym = base; count = subRun; }
      if (pay > 0) {
        const amt = pay * lineBet * mult;
        if (sym === 'J' && count === 5) grand = true;
        wins.push({ line: li, sym, count, amount: amt, cells: line.slice(0, count).map((y, r) => [r, y]) });
        total += amt;
      }
    });
    let scat = 0; const scatCells = [];
    grid.forEach((col, r) => col.forEach((s, y) => { if (s === 'SC') { scat++; scatCells.push([r, y]); } }));
    const sc = Math.min(scat, 5);
    let freeSpins = 0;
    if (sc >= 3) {
      const amt = SLOT.scatterPay[sc] * totalBet * mult;
      total += amt; freeSpins = SLOT.scatterSpins[sc];
      wins.push({ line: -1, sym: 'SC', count: sc, amount: amt, cells: scatCells });
    }
    return { wins, total, freeSpins, grand };
  }

  // ---------- CARDS ----------
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  function makeShoe(decks) {
    const s = [];
    for (let d = 0; d < decks; d++) for (const su of SUITS) for (const r of RANKS) s.push({ r, s: su });
    for (let i = s.length - 1; i > 0; i--) { const j = randInt(i + 1); [s[i], s[j]] = [s[j], s[i]]; }
    s.total = s.length;
    return s;
  }

  // ---------- BLACKJACK ----------
  const bjVal = c => c.r === 'A' ? 11 : ['J', 'Q', 'K', '10'].includes(c.r) ? 10 : +c.r;
  function bjScore(cards) {
    let t = 0, a = 0;
    for (const c of cards) { t += bjVal(c); if (c.r === 'A') a++; }
    while (t > 21 && a) { t -= 10; a--; }
    return { total: t, soft: a > 0 };
  }
  const isBJ = cards => cards.length === 2 && bjScore(cards).total === 21;

  class Blackjack {
    constructor() { this.shoe = makeShoe(6); this.state = 'idle'; }
    draw() {
      if (this.shoe.length < this.shoe.total * 0.25) { this.shoe = makeShoe(6); this.reshuffled = true; }
      return this.shoe.pop();
    }
    deal(bet) {
      this.reshuffled = false;
      this.hands = [{ cards: [this.draw()], bet, done: false, doubled: false }];
      this.dealer = [this.draw()];
      this.hands[0].cards.push(this.draw());
      this.dealer.push(this.draw());
      this.active = 0; this.state = 'play'; this.result = null;
      const pBJ = isBJ(this.hands[0].cards), dBJ = isBJ(this.dealer);
      if (pBJ || dBJ) return this.finish();
      return this;
    }
    get hand() { return this.hands[this.active]; }
    canDouble() { const h = this.hand; return this.state === 'play' && h.cards.length === 2 && !h.splitAces; }
    canSplit() {
      const h = this.hand;
      return this.state === 'play' && this.hands.length < 4 && h.cards.length === 2 && bjVal(h.cards[0]) === bjVal(h.cards[1]) && !h.splitAces;
    }
    hit() {
      const h = this.hand; h.cards.push(this.draw());
      if (bjScore(h.cards).total >= 21) return this.next();
      return this;
    }
    stand() { return this.next(); }
    double() { const h = this.hand; h.bet *= 2; h.doubled = true; h.cards.push(this.draw()); return this.next(); }
    split() {
      const h = this.hand; const c2 = h.cards.pop();
      const aces = h.cards[0].r === 'A';
      const nh = { cards: [c2, this.draw()], bet: h.bet, done: false, split: true, splitAces: aces };
      h.cards.push(this.draw()); h.split = true; h.splitAces = aces;
      this.hands.splice(this.active + 1, 0, nh);
      if (aces) { h.done = true; nh.done = true; return this.finish(); }
      if (bjScore(h.cards).total === 21) return this.next();
      return this;
    }
    next() {
      this.hand.done = true;
      while (this.active < this.hands.length && this.hands[this.active].done) this.active++;
      if (this.active >= this.hands.length) { this.active = this.hands.length - 1; return this.finish(); }
      const h = this.hand; if (bjScore(h.cards).total === 21) return this.next();
      return this;
    }
    finish() {
      this.state = 'done';
      const allBust = this.hands.every(h => bjScore(h.cards).total > 21);
      const natural = this.hands.length === 1 && isBJ(this.hands[0].cards);
      const dBJ = isBJ(this.dealer);
      if (!allBust && !natural && !dBJ) {
        while (true) { const d = bjScore(this.dealer); if (d.total < 17) this.dealer.push(this.draw()); else break; }
      }
      const d = bjScore(this.dealer).total;
      let payout = 0;
      this.hands.forEach(h => {
        const p = bjScore(h.cards).total;
        const pBJ = isBJ(h.cards) && !h.split;
        let res, ret;
        if (pBJ && !dBJ) { res = 'blackjack'; ret = h.bet * 2.5; }
        else if (dBJ && !pBJ) { res = 'lose'; ret = 0; }
        else if (pBJ && dBJ) { res = 'push'; ret = h.bet; }
        else if (p > 21) { res = 'bust'; ret = 0; }
        else if (d > 21 || p > d) { res = 'win'; ret = h.bet * 2; }
        else if (p === d) { res = 'push'; ret = h.bet; }
        else { res = 'lose'; ret = 0; }
        h.result = res; h.ret = ret; payout += ret;
      });
      this.payout = payout;
      return this;
    }
  }

  // ---------- BACCARAT ----------
  const bacVal = c => ['10', 'J', 'Q', 'K'].includes(c.r) ? 0 : c.r === 'A' ? 1 : +c.r;
  const bacScore = cs => cs.reduce((a, c) => a + bacVal(c), 0) % 10;
  const BAC_PAY = { player: 2, banker: 1.95, tie: 9, ppair: 12, bpair: 12 }; // return multipliers incl. stake
  class Baccarat {
    constructor() { this.shoe = makeShoe(8); this.road = []; }
    draw() { if (this.shoe.length < 16) { this.shoe = makeShoe(8); this.road = []; this.reshuffled = true; } return this.shoe.pop(); }
    play(bets) {
      this.reshuffled = false;
      const P = [this.draw()], B = [this.draw()]; P.push(this.draw()); B.push(this.draw());
      let p = bacScore(P), b = bacScore(B);
      if (p < 8 && b < 8) {
        let p3 = null;
        if (p <= 5) { p3 = this.draw(); P.push(p3); }
        const bs = bacScore(B);
        let bDraw;
        if (p3 === null) bDraw = bs <= 5;
        else {
          const v = bacVal(p3);
          bDraw = bs <= 2 || (bs === 3 && v !== 8) || (bs === 4 && v >= 2 && v <= 7) ||
                  (bs === 5 && v >= 4 && v <= 7) || (bs === 6 && (v === 6 || v === 7));
        }
        if (bDraw) B.push(this.draw());
        p = bacScore(P); b = bacScore(B);
      }
      const winner = p > b ? 'player' : b > p ? 'banker' : 'tie';
      const ppair = P[0].r === P[1].r, bpair = B[0].r === B[1].r;
      let payout = 0; const detail = {};
      for (const [k, amt] of Object.entries(bets)) {
        if (!amt) continue;
        let ret = 0;
        if (k === 'player' || k === 'banker') ret = winner === k ? amt * BAC_PAY[k] : winner === 'tie' ? amt : 0;
        else if (k === 'tie') ret = winner === 'tie' ? amt * BAC_PAY.tie : 0;
        else if (k === 'ppair') ret = ppair ? amt * BAC_PAY.ppair : 0;
        else if (k === 'bpair') ret = bpair ? amt * BAC_PAY.bpair : 0;
        detail[k] = ret; payout += ret;
      }
      this.road.push({ w: winner, p, b, ppair, bpair });
      return { P, B, p, b, winner, ppair, bpair, payout, detail };
    }
  }

  // ---------- CRASH: ROCKET JUNJA ----------
  const CRASH_EDGE = 0.97, CRASH_MAX = 1000, CRASH_K = 0.11;
  function crashPoint() {
    const u = rand();
    const x = Math.floor((CRASH_EDGE / (1 - u)) * 100) / 100;
    return Math.max(1, Math.min(CRASH_MAX, x));
  }
  const crashAt = t => Math.exp(CRASH_K * t);         // t seconds -> multiplier
  const crashTime = m => Math.log(m) / CRASH_K;

  // ---------- PLINKO: STARFALL ----------
  const PLINKO_ROWS = 12;
  const PLINKO = {
    low:  [8, 3, 1.6, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.6, 3, 8],
    mid:  [22, 8, 3, 1.9, 1.2, 0.7, 0.3, 0.7, 1.2, 1.9, 3, 8, 22],
    high: [150, 24, 8, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8, 24, 150]
  };
  function plinkoDrop() {
    const path = []; let k = 0;
    for (let i = 0; i < PLINKO_ROWS; i++) { const d = rand() < 0.5 ? 0 : 1; path.push(d); k += d; }
    return { path, slot: k };
  }
  function binom(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
  function plinkoRTP(risk) { const m = PLINKO[risk]; let s = 0; for (let k = 0; k <= PLINKO_ROWS; k++) s += binom(PLINKO_ROWS, k) / 2 ** PLINKO_ROWS * m[k]; return s; }

  return { rand, setRng, randInt, SLOT, slotSpin, slotEvaluate, makeShoe, bjScore, isBJ, Blackjack,
    bacScore, Baccarat, BAC_PAY, crashPoint, crashAt, crashTime, CRASH_MAX, PLINKO, PLINKO_ROWS, plinkoDrop, plinkoRTP };
})();
if (typeof module !== 'undefined') module.exports = S2;
