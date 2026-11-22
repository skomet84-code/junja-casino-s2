'use strict';
const crypto = require('node:crypto');
const core = require('./core');
const tables = require('./tables');
const { q, one, num } = require('./db');
const { bad, HttpError } = core;

function need(u) { if (!u || !u.is_admin) throw new HttpError(403, '관리자만 볼 수 있어요.'); }
async function audit(u, action, detail) {
  await q(`INSERT INTO admin_log(id,ts,admin,action,detail) VALUES($1,$2,$3,$4,$5)`, [core.rid(8), Date.now(), u.nick, action, JSON.stringify(detail).slice(0, 1000)]);
}
function safeEq(a, b) { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); }

async function claim(u, code) {
  if (!u) throw new HttpError(401, '먼저 로그인해 주세요.');
  const real = process.env.ADMIN_CODE;
  if (!real || !safeEq(code || '', real)) throw bad('관리자 코드가 맞지 않아요.');
  await q(`UPDATE users SET is_admin=1 WHERE id=$1`, [u.id]);
  await audit(u, 'claim', {});
  return { ok: true };
}

async function dashboard(u) {
  need(u);
  const now = Date.now(), day = now - 86400000, week = now - 7 * 86400000;
  const users = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(bal),0) AS money, COUNT(*) FILTER (WHERE last_seen>$1) AS online, COUNT(*) FILTER (WHERE created>$2) AS newbies FROM users`, [now - 60000, day]);
  const byGame = await q(`SELECT game, COUNT(*) AS plays, COALESCE(SUM(wager),0) AS wager, COALESCE(SUM(payout),0) AS payout FROM ledger WHERE ts>$1 GROUP BY game ORDER BY game`, [week]);
  const today = await q(`SELECT game, COUNT(*) AS plays, COALESCE(SUM(wager),0) AS wager, COALESCE(SUM(payout),0) AS payout FROM ledger WHERE ts>$1 GROUP BY game`, [day]);
  const big = await q(`SELECT l.ts,l.game,l.wager,l.payout,l.note,u.nick FROM ledger l JOIN users u ON u.id=l.user_id WHERE l.ts>$1 AND l.payout>=l.wager*20 AND l.payout>0 ORDER BY l.payout DESC LIMIT 15`, [week]);
  const g = rows => rows.map(r => ({ game: r.game, plays: num(r.plays), wager: num(r.wager), payout: num(r.payout) }));
  return { users: num(users.n), money: num(users.money), online: num(users.online), newbies: num(users.newbies), week: g(byGame), today: g(today),
    big: big.map(b => ({ ts: num(b.ts), game: b.game, wager: num(b.wager), payout: num(b.payout), note: b.note, nick: b.nick })),
    jackpot: await core.jackpot(), settings: await core.settings(true), tables: await tables.lobby(), draw: await require('./draw').adminToday() };
}
async function users(u, body) {
  need(u);
  const s = String(body.search || '').trim(), sort = { bal: 'bal DESC', recent: 'last_seen DESC', new: 'created DESC' }[body.sort] || 'bal DESC';
  const rows = await q(`SELECT id,nick,bal,peak,created,last_seen,banned,is_admin FROM users ${s ? 'WHERE nick_key LIKE $1' : ''} ORDER BY ${sort} LIMIT 100`, s ? ['%' + core.nickKey(s).replace(/[%_]/g, '') + '%'] : []);
  return { users: rows.map(r => ({ id: r.id, nick: r.nick, bal: num(r.bal), peak: num(r.peak), created: num(r.created), last_seen: num(r.last_seen), banned: !!num(r.banned), admin: !!num(r.is_admin) })) };
}
async function userDetail(u, body) {
  need(u);
  const r = await one(`SELECT id,nick,bal,peak,created,last_seen,banned,is_admin FROM users WHERE id=$1`, [body.id]);
  if (!r) throw bad('없는 회원');
  const led = await q(`SELECT game,wager,payout,note,ts FROM ledger WHERE user_id=$1 ORDER BY ts DESC LIMIT 80`, [body.id]);
  const sum = await q(`SELECT game, COUNT(*) AS plays, COALESCE(SUM(wager),0) AS wager, COALESCE(SUM(payout),0) AS payout FROM ledger WHERE user_id=$1 GROUP BY game`, [body.id]);
  return { user: { id: r.id, nick: r.nick, bal: num(r.bal), peak: num(r.peak), created: num(r.created), last_seen: num(r.last_seen), banned: !!num(r.banned), admin: !!num(r.is_admin) },
    ledger: led.map(l => ({ game: l.game, wager: num(l.wager), payout: num(l.payout), note: l.note, ts: num(l.ts) })),
    summary: sum.map(s => ({ game: s.game, plays: num(s.plays), wager: num(s.wager), payout: num(s.payout) })) };
}
async function adjust(u, body) {
  need(u);
  const amt = Math.trunc(Number(body.amount)); const memo = String(body.memo || '').slice(0, 80);
  if (!Number.isSafeInteger(amt) || amt === 0) throw bad('금액을 확인해 주세요.');
  const t = await one(`SELECT nick,bal FROM users WHERE id=$1`, [body.id]); if (!t) throw bad('없는 회원');
  let bal;
  if (amt > 0) bal = await core.credit(body.id, amt);
  else { const r = await one(`UPDATE users SET bal=GREATEST(0, bal+$2::bigint) WHERE id=$1 RETURNING bal`, [body.id, amt]); bal = num(r.bal); }
  await core.ledger(body.id, 'admin', amt < 0 ? -amt : 0, amt > 0 ? amt : 0, `관리자 ${amt > 0 ? '지급' : '회수'}${memo ? ' · ' + memo : ''}`);
  await audit(u, 'adjust', { target: t.nick, amount: amt, memo });
  return { bal };
}
async function setBal(u, body) {
  need(u);
  const v = Math.floor(Number(body.balance)); if (!Number.isSafeInteger(v) || v < 0) throw bad('금액을 확인해 주세요.');
  const t = await one(`SELECT nick,bal FROM users WHERE id=$1`, [body.id]); if (!t) throw bad('없는 회원');
  await q(`UPDATE users SET bal=$2::bigint, peak=GREATEST(peak,$2::bigint) WHERE id=$1`, [body.id, v]);
  const diff = v - num(t.bal);
  await core.ledger(body.id, 'admin', diff < 0 ? -diff : 0, diff > 0 ? diff : 0, `관리자 잔액 설정 → ${v}`);
  await audit(u, 'setbal', { target: t.nick, from: num(t.bal), to: v });
  return { bal: v };
}
async function ban(u, body) {
  need(u);
  const t = await one(`SELECT nick FROM users WHERE id=$1`, [body.id]); if (!t) throw bad('없는 회원');
  if (body.id === u.id) throw bad('자기 자신은 제한할 수 없어요.');
  await q(`UPDATE users SET banned=$2 WHERE id=$1`, [body.id, body.banned ? 1 : 0]);
  if (body.banned) await q(`DELETE FROM sessions WHERE user_id=$1`, [body.id]);
  await audit(u, body.banned ? 'ban' : 'unban', { target: t.nick });
  return { ok: true };
}
async function resetPw(u, body) {
  need(u);
  const t = await one(`SELECT nick FROM users WHERE id=$1`, [body.id]); if (!t) throw bad('없는 회원');
  const temp = String(crypto.randomInt(100000, 999999)), salt = core.rid(12);
  await q(`UPDATE users SET pw=$2, salt=$3 WHERE id=$1`, [body.id, core.hashPw(temp, salt), salt]);
  await q(`DELETE FROM sessions WHERE user_id=$1`, [body.id]);
  await audit(u, 'resetpw', { target: t.nick });
  return { temp };
}
async function setAdmin(u, body) {
  need(u);
  const t = await one(`SELECT nick FROM users WHERE id=$1`, [body.id]); if (!t) throw bad('없는 회원');
  if (body.id === u.id && !body.admin) throw bad('자기 권한은 해제할 수 없어요.');
  await q(`UPDATE users SET is_admin=$2 WHERE id=$1`, [body.id, body.admin ? 1 : 0]);
  await audit(u, body.admin ? 'grant' : 'revoke', { target: t.nick });
  return { ok: true };
}
async function saveSettings(u, body) {
  need(u);
  const cur = await core.settings(true);
  const next = { ...cur };
  if (body.disabled && typeof body.disabled === 'object') next.disabled = Object.fromEntries(Object.entries(body.disabled).filter(([k]) => core.GAMES.includes(k)).map(([k, v]) => [k, !!v]));
  if (typeof body.notice === 'string') next.notice = body.notice.slice(0, 200);
  await core.saveSettings(next);
  await audit(u, 'settings', next);
  return { settings: next };
}
async function setJackpot(u, body) {
  need(u);
  const v = Math.floor(Number(body.value)); if (!(v >= core.JP_SEED)) throw bad('잭팟은 10억G 이상이어야 해요.');
  await q(`INSERT INTO kv(k,v) VALUES('jackpot',$1) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v`, [String(v)]);
  await audit(u, 'jackpot', { value: v });
  return { jackpot: v };
}
async function resetTable(u, body) {
  need(u);
  const n = await tables.adminReset(String(body.id));
  await audit(u, 'table_reset', { id: body.id, refunded: n });
  return { refunded: n };
}
async function log(u) {
  need(u);
  const rows = await q(`SELECT ts,admin,action,detail FROM admin_log ORDER BY ts DESC LIMIT 100`);
  return { log: rows.map(r => ({ ts: num(r.ts), admin: r.admin, action: r.action, detail: r.detail })) };
}
module.exports = { claim, dashboard, users, userDetail, adjust, setBal, ban, resetPw, setAdmin, saveSettings, setJackpot, resetTable, log };
