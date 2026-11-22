'use strict';
// CELESTIAL 77 — daily shared constellation draw. 77 stars, prizes hidden and shuffled each KST day.
// A star taken by anyone is gone for everyone. Picks per day depend on membership tier.
const crypto = require('node:crypto');
const core = require('./core');
const { q, one, num } = require('./db');
const { bad } = core;

const PRIZES = [ // [rank, count, prize, title]
  [1, 1, 100000000000, 'SUPREME'],
  [2, 2, 10000000000, 'ROYAL'],
  [3, 4, 1000000000, 'GRAND'],
  [4, 10, 100000000, 'MAJOR'],
  [5, 60, 10000000, 'BLESSING']
];
const PRIZE = Object.fromEntries(PRIZES.map(p => [p[0], p[2]]));

function nextResetAt() {
  // next KST midnight
  const now = Date.now(), kst = new Date(now + 9 * 3600000);
  kst.setUTCHours(24, 0, 0, 0);
  return kst.getTime() - 9 * 3600000;
}
async function board(day) {
  let r = await one(`SELECT ranks FROM draw_board WHERE day=$1`, [day]);
  if (!r) {
    const ranks = [];
    PRIZES.forEach(([rank, count]) => { for (let i = 0; i < count; i++) ranks.push(rank); });
    for (let i = ranks.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [ranks[i], ranks[j]] = [ranks[j], ranks[i]]; }
    await q(`INSERT INTO draw_board(day,ranks) VALUES($1,$2) ON CONFLICT (day) DO NOTHING`, [day, JSON.stringify(ranks)]);
    r = await one(`SELECT ranks FROM draw_board WHERE day=$1`, [day]);
    if (Math.random() < 0.1) q(`DELETE FROM draw_board WHERE day < $1`, [core.kstDay(Date.now() - 40 * 86400000)]).catch(() => {});
  }
  return JSON.parse(r.ranks);
}
async function state(u) {
  await core.assertGame('draw');
  const day = core.kstDay();
  const picks = await q(`SELECT number,user_id,nick,rank,prize,ts FROM draw_picks WHERE day=$1 ORDER BY ts`, [day]);
  const t = core.tierOf(u.bal);
  const usedMine = u.draw_day === day ? u.draw_used : 0;
  return {
    day, resetAt: nextResetAt(), prizes: PRIZES.map(([rank, count, prize, title]) => ({ rank, count, prize, title, left: count - picks.filter(p => num(p.rank) === rank).length })),
    taken: picks.map(p => ({ n: num(p.number), nick: p.nick, rank: num(p.rank), mine: p.user_id === u.id })),
    winners: picks.filter(p => num(p.rank) <= 3).map(p => ({ n: num(p.number), nick: p.nick, rank: num(p.rank), prize: num(p.prize), ts: num(p.ts) })),
    left: Math.max(0, t.draws - usedMine), max: t.draws, remaining: 77 - picks.length, tier: core.rankIdx(u.bal)
  };
}
async function pick(u, body) {
  await core.assertGame('draw');
  const n = Math.floor(Number(body.number));
  if (!(n >= 1 && n <= 77)) throw bad('1~77 중에서 골라 주세요.');
  const day = core.kstDay(), t = core.tierOf(u.bal);
  const ranks = await board(day);
  // reserve one pick atomically
  const got = await one(`UPDATE users SET draw_used = CASE WHEN draw_day=$2 THEN draw_used+1 ELSE 1 END, draw_day=$2
     WHERE id=$1 AND (draw_day<>$2 OR draw_used < $3::int) RETURNING draw_used`, [u.id, day, t.draws]);
  if (!got) throw bad(`오늘의 별 ${t.draws}개를 모두 골랐어요. 자정(한국시간)에 새로 열립니다.`);
  const rank = ranks[n - 1], prize = PRIZE[rank], ts = Date.now();
  const ins = await q(`INSERT INTO draw_picks(day,number,user_id,nick,rank,prize,ts) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (day,number) DO NOTHING RETURNING number`, [day, n, u.id, u.nick, rank, prize, ts]);
  if (!ins.length) {
    await q(`UPDATE users SET draw_used = GREATEST(0, draw_used-1) WHERE id=$1 AND draw_day=$2`, [u.id, day]);
    throw bad('방금 다른 분이 가져간 별이에요. 다른 번호를 골라 주세요.');
  }
  const bal = await core.credit(u.id, prize);
  await core.ledger(u.id, 'draw', 0, prize, `셀레스티얼 77 · ${n}번 · ${rank}등 ${PRIZES[rank - 1][3]}`);
  return { number: n, rank, prize, title: PRIZES[rank - 1][3], bal };
}
async function adminToday() {
  const day = core.kstDay();
  const rows = await q(`SELECT number,nick,rank,prize,ts FROM draw_picks WHERE day=$1 ORDER BY rank, ts`, [day]);
  return { day, count: rows.length, picks: rows.map(r => ({ n: num(r.number), nick: r.nick, rank: num(r.rank), prize: num(r.prize), ts: num(r.ts) })) };
}
module.exports = { state, pick, adminToday, PRIZES };
