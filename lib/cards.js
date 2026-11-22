'use strict';
const crypto = require('node:crypto');
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function deck(n = 1) { const d = []; for (let k = 0; k < n; k++) for (const s of SUITS) for (const r of RANKS) d.push({ r, s }); return shuffle(d); }
function randomCard() { return { r: RANKS[crypto.randomInt(0, 13)], s: SUITS[crypto.randomInt(0, 4)] }; }

// ---- 5-card poker evaluation: returns array, compare lexicographically ----
const CAT = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
function eval5(cs) {
  const v = cs.map(c => RV[c.r]).sort((a, b) => b - a);
  const flush = cs.every(c => c.s === cs[0].s);
  let uniq = [...new Set(v)], straightHigh = 0;
  if (uniq.length === 5) {
    if (v[0] - v[4] === 4) straightHigh = v[0];
    else if (v[0] === 14 && v[1] === 5) straightHigh = 5;
  }
  const cnt = {}; v.forEach(x => cnt[x] = (cnt[x] || 0) + 1);
  const groups = Object.entries(cnt).map(([k, c]) => [c, +k]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kick = groups.map(g => g[1]);
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, ...kick];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...kick];
  if (flush) return [5, ...v];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, ...kick];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...kick];
  if (groups[0][0] === 2) return [1, ...kick];
  return [0, ...v];
}
function cmp(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; }
function bestHand(cs) {
  if (cs.length <= 5) { const e = eval5(cs); return { score: e, cards: cs, name: CAT[e[0]] }; }
  // choose 5 of n
  let best = null, bestCards = null; const n = cs.length;
  const rec = (start, pick) => {
    if (pick.length === 5) { const five = pick.map(i => cs[i]); const e = eval5(five); if (!best || cmp(e, best) > 0) { best = e; bestCards = five; } return; }
    for (let i = start; i < n; i++) rec(i + 1, [...pick, i]);
  };
  rec(0, []);
  return { score: best, cards: bestCards, name: CAT[best[0]] };
}

// ---- Video poker: Jacks or Better 8/5 ----
const VP_PAY = [
  ['로열 플러시', 800], ['스트레이트 플러시', 50], ['포카드', 25], ['풀하우스', 8], ['플러시', 5], ['스트레이트', 4], ['트리플', 3], ['투페어', 2], ['잭 이상 원페어', 1]
];
function vpEval(cs) {
  const e = eval5(cs);
  if (e[0] === 8) return e[1] === 14 ? 0 : 1;
  if (e[0] === 7) return 2; if (e[0] === 6) return 3; if (e[0] === 5) return 4; if (e[0] === 4) return 5;
  if (e[0] === 3) return 6; if (e[0] === 2) return 7; if (e[0] === 1 && e[1] >= 11) return 8;
  return -1;
}

// ---- Hwatu for Seotda ----
// month 1,3,8 have 광; 4,7,9 have 열끗
function hwatuDeck() {
  const d = [];
  for (let m = 1; m <= 10; m++) {
    d.push({ m, k: [1, 3, 8].includes(m) ? 'g' : [4, 7, 9].includes(m) ? 'y' : 'a' });
    d.push({ m, k: 'b' });
  }
  return shuffle(d);
}
// returns {v, name, special}
function seotdaRank(a, b) {
  const [x, y] = a.m <= b.m ? [a, b] : [b, a];
  const g = x.k === 'g' && y.k === 'g';
  if (g && x.m === 3 && y.m === 8) return { v: 1000, name: '38광땡' };
  if (g && x.m === 1 && (y.m === 8 || y.m === 3)) return { v: 900, name: `1${y.m}광땡` };
  if (x.m === y.m) return { v: 800 + x.m, name: x.m === 10 ? '장땡' : `${x.m}땡` };
  const pair = x.m * 100 + y.m;
  if (x.m === 4 && y.m === 7 && x.k === 'y' && y.k === 'y') return { v: 501, name: '암행어사', special: 'amhaeng' };
  if (x.m === 3 && y.m === 7) return { v: 500, name: '땡잡이', special: 'ttaengjab' };
  if (x.m === 4 && y.m === 9) {
    if (x.k === 'y' && y.k === 'y') return { v: 503, name: '멍텅구리구사', special: 'mgusa' };
    return { v: 503, name: '구사', special: 'gusa' };
  }
  const named = { 102: ['알리', 700], 104: ['독사', 690], 109: ['구삥', 680], 110: ['장삥', 670], 410: ['장사', 660], 406: ['세륙', 650] }[pair];
  if (named) return { v: named[1], name: named[0] };
  const k = (x.m + y.m) % 10;
  return { v: 500 + k, name: k === 9 ? '갑오' : k === 0 ? '망통' : `${k}끗` };
}

module.exports = { SUITS, RANKS, RV, shuffle, deck, randomCard, eval5, cmp, bestHand, CAT, VP_PAY, vpEval, hwatuDeck, seotdaRank };
