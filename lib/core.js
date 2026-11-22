'use strict';
const crypto = require('node:crypto');
const { q, one, num } = require('./db');

const START_BAL = 100000000;          // 1억
const MIN_BET = 10000, MAX_BET = 10000000000;
const JP_SEED = 1000000000;
const RANKS = [
  [0, '별빛 루키'], [300000000, '문라이트 플레이어'], [1000000000, '골드 하이롤러'],
  [10000000000, '플래티넘 VIP'], [100000000000, '셀레스티아 로열'], [1000000000000, '하늘이 내려준 자']
];
const GAMES = ['slot', 'bj', 'plinko', 'hilo', 'mines', 'dice', 'vpoker', 'crash', 'bac', 'holdem', 'seotda'];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => new HttpError(400, msg);

const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function rnd() { return crypto.randomInt(0, 2 ** 48) / 2 ** 48; }
function rankIdx(peak) { let i = 0; RANKS.forEach((r, k) => { if (peak >= r[0]) i = k; }); return i; }
function kstDay(t = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}
function betAmount(v) {
  const n = Math.floor(Number(v));
  if (!Number.isSafeInteger(n) || n < MIN_BET) throw bad('최소 베팅은 1만G입니다.');
  if (n > MAX_BET) throw bad('최대 베팅은 100억G입니다.');
  return n;
}

// ---------- settings ----------
let settingsCache = null, settingsAt = 0;
async function settings(force) {
  if (!force && settingsCache && Date.now() - settingsAt < 5000) return settingsCache;
  const r = await one(`SELECT v FROM kv WHERE k='settings'`);
  settingsCache = Object.assign({ disabled: {}, notice: '' }, r ? JSON.parse(r.v) : {});
  settingsAt = Date.now();
  return settingsCache;
}
async function saveSettings(s) {
  await q(`INSERT INTO kv(k,v) VALUES('settings',$1) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v`, [JSON.stringify(s)]);
  settingsCache = s; settingsAt = Date.now();
}
async function assertGame(g) {
  const s = await settings();
  if (s.disabled && s.disabled[g]) throw bad('관리자가 잠시 닫아 둔 게임입니다.');
}

// ---------- auth ----------
function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString('hex'); }
function nickKey(n) { return String(n).trim().toLowerCase().normalize('NFC'); }
function validNick(n) {
  n = String(n || '').trim().normalize('NFC');
  if (n.length < 2 || n.length > 12) throw bad('닉네임은 2~12자로 정해 주세요.');
  if (!/^[0-9A-Za-z가-힣_.\-]+$/.test(n)) throw bad('닉네임은 한글·영문·숫자·_ . - 만 쓸 수 있어요.');
  return n;
}
function validPw(p) { p = String(p || ''); if (p.length < 4 || p.length > 64) throw bad('비밀번호는 4자 이상으로 정해 주세요.'); return p; }

async function newSession(userId) {
  const token = rid(24), t = Date.now();
  await q(`INSERT INTO sessions(token,user_id,created,expires) VALUES($1,$2,$3,$4)`, [sha(token), userId, t, t + 1000 * 60 * 60 * 24 * 60]);
  return token;
}
async function register(nick, pw) {
  nick = validNick(nick); pw = validPw(pw);
  const salt = rid(12), id = rid(9), t = Date.now();
  const r = await q(`INSERT INTO users(id,nick,nick_key,pw,salt,bal,peak,created,last_seen,avatar) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$7,$8)
     ON CONFLICT (nick_key) DO NOTHING RETURNING id`, [id, nick, nickKey(nick), hashPw(pw, salt), salt, START_BAL, t, crypto.randomInt(0, 12)]);
  if (!r.length) throw bad('이미 있는 닉네임이에요.');
  await ledger(id, 'bonus', 0, START_BAL, '시즌 2 오픈 기념 지급');
  return { token: await newSession(id) };
}
async function login(nick, pw) {
  const u = await one(`SELECT id,pw,salt,banned FROM users WHERE nick_key=$1`, [nickKey(nick)]);
  if (!u || hashPw(pw, u.salt) !== u.pw) throw bad('닉네임 또는 비밀번호가 맞지 않아요.');
  if (num(u.banned)) throw new HttpError(403, '이용이 제한된 계정입니다. 관리자에게 문의하세요.');
  return { token: await newSession(u.id) };
}
async function logout(token) { if (token) await q(`DELETE FROM sessions WHERE token=$1`, [sha(token)]); }
async function userFromToken(token) {
  if (!token || token.length > 100) return null;
  const r = await one(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires>$2`, [sha(token), Date.now()]);
  if (!r) return null;
  const u = normUser(r);
  if (u.banned) throw new HttpError(403, '이용이 제한된 계정입니다.');
  if (Date.now() - u.last_seen > 20000) q(`UPDATE users SET last_seen=$2 WHERE id=$1`, [u.id, Date.now()]).catch(() => {});
  return u;
}
function normUser(r) {
  return { id: r.id, nick: r.nick, bal: num(r.bal), peak: num(r.peak), created: num(r.created), last_seen: num(r.last_seen), banned: num(r.banned),
    is_admin: num(r.is_admin), daily: r.daily || '', rescue_at: num(r.rescue_at), avatar: num(r.avatar), last_react: num(r.last_react) };
}
function publicMe(u) {
  const ri = rankIdx(u.peak);
  return { id: u.id, nick: u.nick, bal: u.bal, peak: u.peak, avatar: u.avatar, admin: !!u.is_admin, rank: ri, rankName: RANKS[ri][1],
    nextRank: RANKS[ri + 1] ? { at: RANKS[ri + 1][0], name: RANKS[ri + 1][1], from: RANKS[ri][0] } : null,
    dailyReady: u.daily !== kstDay(), dailyAmt: 10000000 * (ri + 1), rescueReadyAt: u.rescue_at + 30 * 60000 };
}

// ---------- wallet ----------
async function debit(uid, amt) {
  if (!(amt > 0)) return balanceOf(uid);
  const r = await one(`UPDATE users SET bal=bal-$2::bigint WHERE id=$1 AND bal>=$2::bigint AND banned=0 RETURNING bal`, [uid, amt]);
  if (!r) throw bad('게임머니가 부족합니다.');
  return num(r.bal);
}
async function credit(uid, amt) {
  if (!(amt > 0)) return balanceOf(uid);
  const r = await one(`UPDATE users SET bal=bal+$2::bigint, peak=GREATEST(peak, bal+$2::bigint) WHERE id=$1 RETURNING bal`, [uid, Math.floor(amt)]);
  return r ? num(r.bal) : 0;
}
async function balanceOf(uid) { const r = await one(`SELECT bal FROM users WHERE id=$1`, [uid]); return r ? num(r.bal) : 0; }
async function ledger(uid, game, wager, payout, note) {
  await q(`INSERT INTO ledger(id,user_id,game,wager,payout,note,ts) VALUES($1,$2,$3,$4,$5,$6,$7)`, [rid(10), uid, game, Math.floor(wager), Math.floor(payout), String(note || '').slice(0, 200), Date.now()]);
}

// ---------- jackpot ----------
async function jackpot() { const r = await one(`SELECT v FROM kv WHERE k='jackpot'`); return r ? Number(r.v) : JP_SEED; }
async function jackpotAdd(a) {
  await q(`INSERT INTO kv(k,v) VALUES('jackpot',$1) ON CONFLICT (k) DO UPDATE SET v=(CAST(kv.v AS BIGINT)+$2::bigint)::text`, [String(JP_SEED + Math.floor(a)), Math.floor(a)]);
}
async function jackpotTake(fraction) {
  // atomically take a share of the pool, never leaving it below the seed
  for (let i = 0; i < 4; i++) {
    const cur = await jackpot();
    const award = Math.floor(cur * Math.min(1, fraction));
    const next = Math.max(JP_SEED, cur - award);
    const r = await q(`UPDATE kv SET v=$2 WHERE k='jackpot' AND v=$1 RETURNING k`, [String(cur), String(next)]);
    if (r.length) return award;
    if (!(await one(`SELECT v FROM kv WHERE k='jackpot'`))) { await q(`INSERT INTO kv(k,v) VALUES('jackpot',$1) ON CONFLICT DO NOTHING`, [String(JP_SEED)]); }
  }
  return 0;
}

// ---------- reactions ----------
const REACTIONS = ['😂', '😎', '🔥', '😱', '🙏', '👑', '💸', '🚀', '🤡', '👏', '🥂', '💎',
  '가즈아!!', '떡상 간다', '올인 각?', '쫄?', '졌잘싸', 'ㅋㅋㅋㅋㅋ', '하늘이 내려준 자 등판', '오늘 운 미쳤다',
  '한 판만 더', 'GG', '콜!', '다이…', '뻥카 아님 ㅋ', '부럽다…', '축하해요', '살려줘…'];
async function react(u, room, code) {
  room = String(room || 'lobby').slice(0, 40);
  if (!/^[a-z0-9:_-]+$/.test(room)) throw bad('room');
  const idx = Number(code);
  if (!Number.isInteger(idx) || !REACTIONS[idx]) throw bad('없는 리액션이에요.');
  const t = Date.now();
  const ok = await one(`UPDATE users SET last_react=$2 WHERE id=$1 AND last_react<$3 RETURNING id`, [u.id, t, t - 1200]);
  if (!ok) throw bad('잠깐만요, 너무 빨라요.');
  await q(`INSERT INTO reactions(id,room,user_id,nick,code,ts) VALUES($1,$2,$3,$4,$5,$6)`, [rid(8), room, u.id, u.nick, String(idx), t]);
  if (Math.random() < 0.02) q(`DELETE FROM reactions WHERE ts<$1`, [t - 3600000]).catch(() => {});
  return { ok: true };
}
async function reactionsSince(room, since) {
  const rows = await q(`SELECT id,user_id,nick,code,ts FROM reactions WHERE room=$1 AND ts>$2 ORDER BY ts DESC LIMIT 20`, [room, Math.max(since, Date.now() - 8000)]);
  return rows.map(r => ({ id: r.id, uid: r.user_id, nick: r.nick, code: num(r.code), ts: num(r.ts) }));
}

module.exports = { START_BAL, MIN_BET, MAX_BET, JP_SEED, RANKS, GAMES, REACTIONS, HttpError, bad, rid, sha, rnd, rankIdx, kstDay, betAmount,
  settings, saveSettings, assertGame, register, login, logout, userFromToken, normUser, publicMe, debit, credit, balanceOf, ledger,
  jackpot, jackpotAdd, jackpotTake, react, reactionsSince, hashPw, nickKey };
