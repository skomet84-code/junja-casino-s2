/* Client core: api, state, router, ui helpers */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmt(n) {
    n = Math.floor(Number(n) || 0); const neg = n < 0; n = Math.abs(n); let s;
    const t = v => (v >= 100 ? Math.floor(v * 10) / 10 : Math.floor(v * 100) / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    if (n >= 1e12) s = t(n / 1e12) + '조'; else if (n >= 1e8) s = t(n / 1e8) + '억'; else if (n >= 1e4) s = t(n / 1e4) + '만'; else s = n.toLocaleString('ko-KR');
    return (neg ? '-' : '') + s;
  }
  const full = n => Math.floor(Number(n) || 0).toLocaleString('ko-KR');
  const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? '방금' : s < 3600 ? Math.floor(s / 60) + '분 전' : s < 86400 ? Math.floor(s / 3600) + '시간 전' : Math.floor(s / 86400) + '일 전'; };
  const store = { get(k, d) { try { const v = localStorage.getItem('s2.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('s2.' + k, JSON.stringify(v)); } catch {} } };

  const App = { me: null, info: null, token: store.get('tok', ''), reactions: [] };
  async function api(method, path, body) {
    const r = await fetch('/api/' + path, { method, headers: { 'content-type': 'application/json', ...(App.token ? { 'x-token': App.token } : {}) }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let j = {}; try { j = await r.json(); } catch {}
    if (r.status === 401 && path !== 'login') { App.me = null; if (window.showAuth) window.showAuth(); }
    if (!r.ok) { const e = new Error(j.error || '연결이 불안정해요.'); e.status = r.status; throw e; }
    if (typeof j.bal === 'number') setBal(j.bal);
    return j;
  }
  const GET = p => api('GET', p), POST = (p, b) => api('POST', p, b || {});
  async function act(fn) { try { return await fn(); } catch (e) { toast(e.message, true); throw e; } }

  // ---------- balance ----------
  let shown = null;
  function setBal(n, anim = true) {
    if (!App.me) return; const prev = App.me.bal; App.me.bal = n;
    const el = $('#bal'); if (!el) return;
    el.textContent = fmt(n); el.title = full(n) + 'G';
    if (anim && shown !== null && n !== shown) { el.classList.remove('up', 'down'); void el.offsetWidth; el.classList.add(n > shown ? 'up' : 'down'); }
    shown = n; void prev;
    document.dispatchEvent(new CustomEvent('bal'));
  }

  // ---------- toasts / modals ----------
  function toast(msg, err, ms = 2000) {
    $$('.toast').forEach(t => t.remove());
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  function modal(html, onMount) {
    const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="in">${html}</div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) close(); });
    if (onMount) onMount(m.querySelector('.in'), close);
    return close;
  }
  function confirmBox(title, msg, ok = '확인', danger) {
    return new Promise(res => modal(`<h4>${esc(title)}</h4><p>${esc(msg)}</p><div class="row"><button class="btn dark" data-a="0">취소</button><button class="btn ${danger ? 'ruby' : 'gold'}" data-a="1">${esc(ok)}</button></div>`,
      (el, close) => el.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) { close(); res(b.dataset.a === '1'); } })));
  }

  // ---------- sound ----------
  let AC = null;
  function sfx(kind) {
    if (!store.get('sound', true)) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
      const t = AC.currentTime;
      const tone = (f, d, dl = 0, type = 'sine', v = .07) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t + dl); g.gain.linearRampToValueAtTime(v, t + dl + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dl + d); o.connect(g); g.connect(AC.destination); o.start(t + dl); o.stop(t + dl + d + .02); };
      ({
        click: () => tone(880, .05, 0, 'triangle', .035), tick: () => tone(300 + Math.random() * 90, .035, 0, 'square', .015), stop: () => tone(170, .09, 0, 'triangle', .06),
        card: () => tone(1100, .04, 0, 'triangle', .03), chip: () => { tone(1500, .03, 0, 'square', .02); tone(2100, .03, .03, 'square', .015); },
        win: () => [523, 659, 784].forEach((f, i) => tone(f, .28, i * .08, 'triangle', .06)), big: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, .45, i * .09, 'triangle', .07)),
        lose: () => tone(150, .3, 0, 'sawtooth', .03), boom: () => { tone(80, .6, 0, 'sawtooth', .09); tone(55, .7, .05, 'square', .05); }, pop: () => tone(620, .08, 0, 'sine', .06)
      }[kind] || (() => {}))();
    } catch {}
  }

  // ---------- big win + confetti ----------
  let bigOpen = false;
  function bigWin(amount, x, title) {
    bigOpen = true; sfx('big');
    const t = title || (x >= 200 ? 'HEAVENLY' : x >= 50 ? 'MEGA WIN' : 'BIG WIN');
    const sub = title === 'GRAND JACKPOT' ? '하늘이 내려준 자' : x >= 200 ? '하늘이 내려준 승리' : x >= 50 ? '별이 쏟아진다' : '운이 깨어났다';
    const o = document.createElement('div'); o.className = 'bigwin';
    o.innerHTML = `<div class="in"><div class="sub">${sub}</div><div class="t foil">${t}</div><div class="a">0</div><div class="x">${x ? '×' + x.toFixed(2) : ''}</div><div class="tap">화면을 누르면 닫힙니다</div></div>`;
    document.body.appendChild(o);
    const a = o.querySelector('.a'), t0 = performance.now(), dur = title ? 3000 : 1800;
    (function step(now) { const p = Math.min(1, (now - t0) / dur); a.textContent = full(amount * (1 - Math.pow(1 - p, 3))) + ' G'; if (p < 1 && o.isConnected) requestAnimationFrame(step); })(t0);
    confetti(title ? 260 : x >= 50 ? 180 : 110);
    const close = () => { o.remove(); bigOpen = false; };
    o.onclick = close; setTimeout(() => o.isConnected && close(), dur + 2500);
  }
  const fx = $('#fx'), fxc = fx.getContext('2d'); let parts = [], fxOn = false;
  function confetti(k) {
    fx.width = innerWidth * devicePixelRatio; fx.height = innerHeight * devicePixelRatio;
    const cols = ['#fff3cf', '#e2c07a', '#b48a42', '#c7b6ff', '#9b7bff', '#ffffff'];
    for (let i = 0; i < k; i++) parts.push({ x: innerWidth / 2 + (Math.random() - .5) * 140, y: innerHeight * .42, vx: (Math.random() - .5) * 15, vy: -Math.random() * 15 - 4, r: Math.random() * 6 + 3, c: cols[i % cols.length], a: Math.random() * 6, va: (Math.random() - .5) * .4, l: 1 });
    if (!fxOn) { fxOn = true; requestAnimationFrame(loop); }
    function loop() {
      const d = devicePixelRatio; fxc.setTransform(d, 0, 0, d, 0, 0); fxc.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter(p => p.l > 0 && p.y < innerHeight + 30);
      for (const p of parts) { p.vy += .34; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va; p.l -= .006; fxc.save(); fxc.globalAlpha = Math.max(0, p.l); fxc.translate(p.x, p.y); fxc.rotate(p.a); fxc.fillStyle = p.c; fxc.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); fxc.restore(); }
      if (parts.length) requestAnimationFrame(loop); else { fxOn = false; fxc.clearRect(0, 0, innerWidth, innerHeight); }
    }
  }
  function winFx(payout, wager, title) {
    if (!wager) { if (payout > 0) sfx('win'); return; }
    const x = payout / wager;
    if (title || (x >= 20 && payout >= 200000)) bigWin(payout, x, title); else if (payout > wager) sfx('win'); else if (payout === 0) sfx('lose');
  }

  // ---------- bet control ----------
  const CHIPS = [10000, 100000, 1000000, 10000000, 100000000, 1000000000, 10000000000];
  const CHIPC = ['#5b6472', '#2f62d8', '#1c9a70', '#d07a26', '#7354e6', '#c8203f', '#a8823f'];
  function betControl(el, key, def = 100000) {
    let v = store.get('bet.' + key, def), locked = false;
    el.classList.add('bet');
    el.innerHTML = `<div class="betline"><button class="sq" data-o="h">½</button><div class="betv"><small>BET</small><b></b></div><button class="sq" data-o="d">×2</button><button class="sq" data-o="m">MAX</button></div><div class="chips">${CHIPS.map((c, i) => `<button class="chip" style="--c:${CHIPC[i]}" data-v="${c}">${fmt(c)}</button>`).join('')}</div>`;
    const clamp = x => Math.max(10000, Math.min(10000000000, Math.floor(x / 10000) * 10000));
    const render = () => { el.querySelector('.betv b').textContent = fmt(v); el.querySelector('.betv').title = full(v) + 'G'; $$('.chip', el).forEach(c => c.classList.toggle('sel', +c.dataset.v === v)); el.querySelector('.betv b').style.color = App.me && v > App.me.bal ? '#ff8197' : ''; $$('button', el).forEach(b => b.disabled = locked); };
    el.addEventListener('click', e => {
      if (locked) return; const o = e.target.closest('[data-o]'), c = e.target.closest('.chip');
      if (o) v = o.dataset.o === 'h' ? v / 2 : o.dataset.o === 'd' ? v * 2 : Math.min(App.me ? App.me.bal : v, 10000000000);
      else if (c) v = +c.dataset.v; else return;
      v = clamp(v); store.set('bet.' + key, v); sfx('chip'); render();
    });
    document.addEventListener('bal', render);
    render();
    return { get: () => v, lock(b) { locked = b; render(); }, set(x) { v = clamp(x); render(); } };
  }
  function chipPicker(el, key, def = 1000000) {
    let v = store.get('chip.' + key, def);
    el.className = 'chips';
    el.innerHTML = CHIPS.map((c, i) => `<button class="chip" style="--c:${CHIPC[i]}" data-v="${c}">${fmt(c)}</button>`).join('');
    const render = () => $$('.chip', el).forEach(c => c.classList.toggle('sel', +c.dataset.v === v));
    el.addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; v = +c.dataset.v; store.set('chip.' + key, v); sfx('chip'); render(); });
    render(); return { get: () => v };
  }

  // ---------- cards ----------
  function card(c, cls = '') {
    const d = document.createElement('div');
    if (!c) { d.className = 'pc back ' + cls; return d; }
    const red = c.s === '♥' || c.s === '♦'; d.className = 'pc ' + (red ? 'red ' : '') + cls;
    d.innerHTML = `<span class="r">${esc(c.r)}</span><span class="s">${c.s}</span><span class="c">${c.s}</span>`; return d;
  }
  const HW = { 1: ['송학', '🌲'], 2: ['매조', '🐦'], 3: ['벚꽃', '🌸'], 4: ['흑싸리', '🌿'], 5: ['난초', '🪻'], 6: ['모란', '🌺'], 7: ['홍싸리', '🐗'], 8: ['공산', '🌕'], 9: ['국진', '🌼'], 10: ['단풍', '🍁'] };
  function hwatu(c, cls = '') {
    const d = document.createElement('div');
    if (!c) { d.className = 'hw back ' + cls; return d; }
    d.className = 'hw ' + cls;
    d.innerHTML = `<span class="m">${c.m}</span><span class="ic">${HW[c.m][1]}</span><span class="n">${HW[c.m][0]}</span>${c.k === 'g' ? '<span class="bd">光</span>' : c.k === 'y' ? '<span class="bd y">열</span>' : ''}`;
    return d;
  }

  // ---------- polling ----------
  function poller(fn, msFn) {
    let alive = true, timer = 0;
    const run = async () => { if (!alive) return; if (document.hidden) { timer = setTimeout(run, 1500); return; } try { await fn(); } catch (e) { /* keep polling */ } if (alive) timer = setTimeout(run, typeof msFn === 'function' ? msFn() : msFn); };
    run();
    return { stop() { alive = false; clearTimeout(timer); }, now() { clearTimeout(timer); run(); } };
  }
  let clockOff = 0;
  const syncClock = serverNow => { if (serverNow) clockOff = clockOff ? clockOff * .7 + (serverNow - Date.now()) * .3 : serverNow - Date.now(); };
  const now = () => Date.now() + clockOff;

  // ---------- reactions ----------
  const seenRx = new Set();
  let rxRoom = null, rxTarget = null;
  function rxBind(room, target) { rxRoom = room; rxTarget = target; $('#rxBtn').classList.toggle('hide', !room); }
  function rxShow(list) {
    if (!list) return;
    list.slice().reverse().forEach(r => {
      if (seenRx.has(r.id)) return; seenRx.add(r.id);
      if (Date.now() - (r.ts - clockOff) > 7000) return;
      if (r.code >= 90) { const t = r.code - 90; const f = $('#floaty'); const d = document.createElement('div'); d.className = 'ent t' + t; d.innerHTML = `<small>${t >= 5 ? '👑 HEAVEN SENT' : '✺ CELESTIA ROYAL'}</small>${esc(r.nick)}님이 입장하셨습니다`; f.appendChild(d); sfx('win'); setTimeout(() => d.remove(), 4300); return; }
      const text = App.reactions[r.code]; if (!text) return;
      const emoji = r.code < 12;
      if (rxTarget) { const host = rxTarget(r.uid); if (host) { const b = document.createElement('div'); b.className = 'bubble' + (emoji ? ' e' : ''); b.textContent = text; host.appendChild(b); setTimeout(() => b.remove(), 3700); sfx('pop'); return; } }
      const f = $('#floaty'); const d = document.createElement('div'); d.className = emoji ? 'e' : '';
      d.innerHTML = `<small>${esc(r.nick)}</small>${esc(text)}`; f.appendChild(d); sfx('pop');
      setTimeout(() => d.remove(), 4300); while (f.children.length > 4) f.firstChild.remove();
    });
  }
  function rxOpen() {
    if (!App.me) return;
    const dim = document.createElement('div'); dim.className = 'rx-dim';
    const sh = document.createElement('div'); sh.className = 'rx-sheet';
    const R = App.reactions;
    sh.innerHTML = `<div class="em">${R.slice(0, 12).map((t, i) => `<button data-c="${i}">${t}</button>`).join('')}</div><div class="ph">${R.slice(12).map((t, i) => { const c = i + 12, need = (App.info && App.info.reactMin || {})[c]; return `<button data-c="${c}" class="${need && App.me.rank < need ? 'lock' : ''}">${esc(t)}</button>`; }).join('')}</div>`;
    const close = () => { dim.remove(); sh.remove(); };
    dim.onclick = close;
    sh.onclick = async e => { const b = e.target.closest('[data-c]'); if (!b) return; if (b.classList.contains('lock')) { const need = App.info.reactMin[b.dataset.c]; return toast(`${(App.info.tiers[need] || {}).name} 이상 전용 문구예요.`, true); } close(); try { await POST('react', { room: rxRoom, code: +b.dataset.c }); sfx('pop'); document.dispatchEvent(new CustomEvent('rxsent')); } catch (er) { toast(er.message, true); } };
    document.body.append(dim, sh);
  }

  // ---------- router ----------
  const views = {}; let cur = null, curName = '';
  function register(name, v) { views[name] = v; }
  function go(hash) { if (location.hash !== '#' + hash) location.hash = hash; else route(); }
  function route() {
    const h = (location.hash || '#lobby').slice(1), [name, arg] = h.split('-');
    const v = views[name] || views.lobby;
    if (!App.me && name !== 'auth') { if (window.showAuth) window.showAuth(); return; }
    if (cur && cur.unmount) try { cur.unmount(); } catch {}
    rxBind(null, null);
    $$('.view').forEach(x => x.classList.remove('on'));
    const el = $('#v-' + (views[name] ? name : 'lobby')); el.classList.add('on');
    cur = v; curName = name;
    $$('.nav button').forEach(b => b.classList.toggle('on', b.dataset.go === name || (b.dataset.go === 'lobby' && !['rank', 'me', 'tables', 'table'].includes(name)) || (b.dataset.go === 'tables' && name === 'table')));
    document.body.classList.toggle('nonav', name === 'table');
    window.scrollTo(0, 0);
    if (v.mount) v.mount(el, arg);
  }
  window.addEventListener('hashchange', route);

  window.S2 = { $, $$, sleep, esc, fmt, full, ago, store, App, api, GET, POST, act, setBal, toast, modal, confirmBox, sfx, bigWin, winFx, get bigOpen() { return bigOpen; },
    betControl, chipPicker, card, hwatu, poller, syncClock, now, rxBind, rxShow, rxOpen, register, go, route, CHIPS, CHIPC };
})();
