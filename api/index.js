'use strict';
const core = require('../lib/core');
const solo = require('../lib/solo');
const live = require('../lib/live');
const tables = require('../lib/tables');
const admin = require('../lib/admin');
const draw = require('../lib/draw');
const { q, one, num } = require('../lib/db');
const { HttpError, bad } = core;

function cookies(req) {
  const out = {}; String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
async function readBody(req) {
  if (req.body !== undefined) { if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch { return {}; } } return req.body || {}; }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}
function send(res, status, obj, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}
const sessCookie = (token, secure) => `s2t=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 60}${secure ? '; Secure' : ''}`;

async function route(method, path, req, body, query) {
  const token = req.headers['x-token'] || cookies(req).s2t || '';
  const u = await core.userFromToken(token);
  const need = () => { if (!u) throw new HttpError(401, '로그인이 필요해요.'); return u; };
  const since = Number(query.get('since')) || 0;
  const parts = path.split('/').filter(Boolean);
  const P = method + ' ' + path;

  switch (P) {
    case 'GET /health': { const r = await one('SELECT 1 AS ok'); return { ok: num(r.ok) === 1, time: Date.now() }; }
    case 'POST /register': return { __login: await core.register(body.nick, body.pw) };
    case 'POST /login': return { __login: await core.login(body.nick, body.pw) };
    case 'POST /logout': await core.logout(token); return { __logout: true };
    case 'GET /me': {
      const s = await core.settings();
      const online = await one(`SELECT COUNT(*) AS n FROM users WHERE last_seen>$1`, [Date.now() - 60000]);
      const ticker = await q(`SELECT l.game,l.wager,l.payout,l.ts,l.note,u.nick FROM ledger l JOIN users u ON u.id=l.user_id WHERE l.ts>$1 AND ((l.wager>0 AND l.payout>=l.wager*10) OR (l.game='draw' AND l.payout>=1000000000)) ORDER BY l.ts DESC LIMIT 12`, [Date.now() - 86400000 * 3]);
      return { me: u ? core.publicMe(u) : null, notice: s.notice || '', disabled: s.disabled || {}, jackpot: await core.jackpot(), online: num(online.n),
        ticker: ticker.map(t => ({ game: t.game, nick: t.nick, x: num(t.wager) ? num(t.payout) / num(t.wager) : 0, payout: num(t.payout), ts: num(t.ts), note: t.game === 'draw' ? t.note : undefined })), reactions: core.REACTIONS, reactMin: core.REACT_MIN, tiers: core.TIERS };
    }
    case 'POST /daily': {
      need(); const day = core.kstDay(), amt = core.tierOf(u.bal).daily;
      const r = await one(`UPDATE users SET daily=$2 WHERE id=$1 AND daily<>$2 RETURNING id`, [u.id, day]);
      if (!r) throw bad('오늘은 이미 받았어요.');
      const bal = await core.credit(u.id, amt); await core.ledger(u.id, 'bonus', 0, amt, '출석 보너스');
      return { amount: amt, bal };
    }
    case 'POST /rescue': {
      need(); const t = Date.now(), tier = core.TIERS[0];
      const r = await one(`UPDATE users SET rescue_at=$2 WHERE id=$1 AND bal<$3 AND rescue_at<$4 RETURNING id`, [u.id, t, core.MIN_BET, t - tier.rescueMin * 60000]);
      if (!r) throw bad(u.bal >= core.MIN_BET ? '잔액이 1만G 미만일 때만 받을 수 있어요.' : `${tier.rescueMin}분에 한 번만 받을 수 있어요.`);
      const bal = await core.credit(u.id, tier.rescue); await core.ledger(u.id, 'bonus', 0, tier.rescue, '천사의 구제금');
      return { amount: tier.rescue, bal };
    }
    case 'POST /avatar': { need(); const a = Math.floor(Number(body.avatar)); if (!(a >= 0 && a < 12)) throw bad('avatar'); await q(`UPDATE users SET avatar=$2 WHERE id=$1`, [u.id, a]); return { ok: true }; }
    case 'GET /history': {
      need();
      const rows = await q(`SELECT game,wager,payout,note,ts FROM ledger WHERE user_id=$1 ORDER BY ts DESC LIMIT 60`, [u.id]);
      const sum = await q(`SELECT game, COUNT(*) AS plays, COALESCE(SUM(wager),0) AS wager, COALESCE(SUM(payout),0) AS payout, COUNT(*) FILTER (WHERE payout>wager) AS wins, COALESCE(MAX(payout-wager),0) AS best FROM ledger WHERE user_id=$1 GROUP BY game`, [u.id]);
      return { history: rows.map(r => ({ game: r.game, wager: num(r.wager), payout: num(r.payout), note: r.note, ts: num(r.ts) })),
        stats: sum.map(s => ({ game: s.game, plays: num(s.plays), wager: num(s.wager), payout: num(s.payout), wins: num(s.wins), best: num(s.best) })) };
    }
    case 'GET /rank': {
      const rich = await q(`SELECT nick,bal,peak,avatar FROM users WHERE banned=0 ORDER BY bal DESC LIMIT 20`);
      // rank list carries tier for frames
      const hof = await q(`SELECT l.game,l.wager,l.payout,l.note,l.ts,u.nick FROM ledger l JOIN users u ON u.id=l.user_id WHERE l.wager>0 AND l.payout>=l.wager*50 ORDER BY l.payout DESC LIMIT 20`);
      return { rich: rich.map(r => ({ nick: r.nick, bal: num(r.bal), avatar: num(r.avatar), rank: core.rankIdx(num(r.bal)) })),
        hof: hof.map(h => ({ game: h.game, nick: h.nick, wager: num(h.wager), payout: num(h.payout), note: h.note, ts: num(h.ts) })) };
    }
    case 'POST /react': need(); return core.react(u, body.room, body.code);
    case 'GET /tiers': return { tiers: core.TIERS, reactMin: core.REACT_MIN, prizes: draw.PRIZES };
    case 'GET /draw': need(); return draw.state(u);
    case 'POST /draw/pick': need(); return draw.pick(u, body);
    case 'GET /lobby': return { tables: await tables.lobby(), reacts: await core.reactionsSince('lobby', since) };
    // solo
    case 'POST /slot': need(); return solo.slot(u, body);
    case 'GET /slot': need(); return solo.slotState(u);
    case 'POST /plinko': need(); return solo.plinko(u, body);
    case 'POST /dice': need(); return solo.dice(u, body);
    case 'POST /bj': need(); return solo.bj(u, body);
    case 'POST /hilo': need(); return solo.hilo(u, body);
    case 'POST /mines': need(); return solo.mines(u, body);
    case 'POST /vpoker': need(); return solo.vpoker(u, body);
    // live
    case 'GET /crash': return live.crashState(u, since);
    case 'POST /crash/bet': need(); return live.crashBet(u, body);
    case 'POST /crash/cashout': need(); return live.crashCashout(u);
    case 'GET /bac': return live.bacState(u, since);
    case 'POST /bac/bet': need(); return live.bacBet(u, body);
  }
  if (parts[0] === 'table' && parts[1]) {
    const id = parts[1];
    if (method === 'GET' && parts.length === 2) return tables.state(u, id, since);
    need();
    if (method === 'POST' && parts[2] === 'sit') return tables.sit(u, id, body);
    if (method === 'POST' && parts[2] === 'leave') return tables.leave(u, id);
    if (method === 'POST' && parts[2] === 'act') return tables.act(u, id, body);
  }
  if (parts[0] === 'admin' && method === 'POST') {
    const fn = { claim: admin.claim, dashboard: admin.dashboard, users: admin.users, user: admin.userDetail, adjust: admin.adjust, setbal: admin.setBal, ban: admin.ban,
      draw: (u) => { if (!u || !u.is_admin) throw new HttpError(403, '관리자만'); return draw.adminToday(); },
      resetpw: admin.resetPw, setadmin: admin.setAdmin, settings: admin.saveSettings, jackpot: admin.setJackpot, table: admin.resetTable, log: admin.log }[parts[1]];
    if (fn) return parts[1] === 'claim' ? fn(u, body.code) : fn(u, body);
  }
  throw new HttpError(404, '없는 주소');
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = url.searchParams.get('p');
  path = '/' + String(path != null ? path : url.pathname.replace(/^\/api\/?/, '').replace(/^index\/?/, '')).replace(/^\/+/, '').replace(/\/+$/, '');
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https');
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await route(req.method, path, req, body, url.searchParams);
    if (out && out.__login) return send(res, 200, { ok: true, token: out.__login.token }, { 'Set-Cookie': sessCookie(out.__login.token, secure) });
    if (out && out.__logout) return send(res, 200, { ok: true }, { 'Set-Cookie': 's2t=; Path=/; Max-Age=0' });
    send(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[api]', path, e);
    send(res, status, { error: status >= 500 ? '서버 오류가 났어요. 잠시 후 다시 시도해 주세요.' : e.message });
  }
};
