/* Single-player games (outcomes decided on the server) */
(function () {
  'use strict';
  const { $, $$, esc, fmt, full, sleep, App, POST, toast, sfx, register, betControl, card, winFx, store } = S2;
  const err = e => toast(e.message, true);

  // ================= SLOT =================
  const LINES = [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1]];
  const SYMS = ['J', 'S7', 'CR', 'DI', 'MO', 'A', 'K', 'Q', 'SC'], FILL = ['S7', 'CR', 'DI', 'MO', 'A', 'A', 'K', 'K', 'Q', 'Q', 'Q', 'J', 'SC'];
  const PAY = { J: [30, 150, 2000], S7: [50, 200, 1000], CR: [25, 100, 500], DI: [20, 60, 250], MO: [12, 35, 140], A: [7, 18, 70], K: [5, 14, 55], Q: [2, 10, 45] };
  const symCache = {}; const symSVG = k => symCache[k] || (symCache[k] = SYM[k]());
  let slotV = null;
  register('slot', {
    async mount(el) {
      el.innerHTML = S2.head('slot') + `<div class="freebar" id="fb"></div>
        <div class="machine"><div class="mtop"><span>10 LINES · WILD · FREE SPINS</span><span>JACKPOT <b class="foil" id="sjp">-</b></span></div>
        <div class="reels" id="reels"><svg class="paylines" id="pl"></svg></div><div class="smsg" id="sm">스핀을 눌러 시작하세요</div></div>
        <div id="sb"></div>
        <div class="row" style="margin-top:10px"><button class="btn gold xl" id="spin" style="flex:2">SPIN</button><button class="btn violet xl" id="auto">AUTO</button></div>
        <div class="opt"><label class="tog"><input type="checkbox" id="turbo"><i></i>터보</label><div class="seg" id="an"><button data-n="10" class="on">10회</button><button data-n="50">50회</button><button data-n="100">100회</button></div></div>
        <details class="rules"><summary>배당표 · 규칙</summary><div class="panel"><div class="pay">${Object.entries(PAY).map(([k, p]) => `<div>${symSVG(k)}<span>3 ×${p[0]} · 4 ×${p[1]}<br>5 <b class="gold">×${p[2]}</b></span></div>`).join('')}<div style="grid-column:1/-1">${symSVG('SC')}<span>후광 3/4/5개 어디서나 → 총 베팅 ×2/×10/×50 + 프리스핀 8/10/15회</span></div></div>
        배당은 라인 베팅(총 베팅 ÷ 10) 기준이며 왼쪽 릴부터 3개 이상 연속이어야 합니다. J(와일드)는 후광을 뺀 모든 심볼을 대신합니다. 프리스핀 당첨금은 2배. 한 라인에 J 5개면 <b class="gold">GRAND JACKPOT</b> (총 베팅 1억G 이상이면 적립금 100%, 미만이면 비율만큼). 모든 베팅의 1%가 잭팟에 쌓입니다. 이론 환수율 약 96%.</div></details>`;
      const bet = betControl($('#sb', el), 'slot', 100000);
      const reelsEl = $('#reels', el), svg = $('#pl', el);
      const reels = [];
      for (let r = 0; r < 5; r++) { const reel = document.createElement('div'); reel.className = 'reel'; const strip = document.createElement('div'); strip.className = 'strip'; reel.appendChild(strip); reelsEl.insertBefore(reel, svg); reels.push(strip); }
      const symEl = k => { const d = document.createElement('div'); d.className = 'sym'; d.dataset.k = k; d.innerHTML = symSVG(k); return d; };
      const rnd = () => FILL[Math.floor(Math.random() * FILL.length)];
      reels.forEach(s => { for (let i = 0; i < 3; i++) s.appendChild(symEl(rnd())); });
      const step = () => reels[0].firstChild.getBoundingClientRect().height + 4;
      let spinning = false, autoLeft = 0, autoN = 10, free = 0, freeTotal = 0, lastWins = [], alive = true;
      const ui = () => {
        $('#spin', el).textContent = free > 0 ? `FREE SPIN · ${free}` : 'SPIN';
        $('#spin', el).disabled = spinning || (autoLeft > 0 && !free);
        $('#auto', el).textContent = autoLeft > 0 ? `STOP ${autoLeft}` : 'AUTO'; $('#auto', el).disabled = free > 0;
        $('#fb', el).classList.toggle('on', free > 0); $('#fb', el).textContent = `✺ FREE SPINS ${free}회 남음 · 당첨금 ×2 · 누적 ${fmt(freeTotal)}G`;
        bet.lock(spinning || autoLeft > 0 || free > 0);
      };
      const clearWins = () => { $$('.sym', reelsEl).forEach(s => s.classList.remove('win', 'dim')); svg.innerHTML = ''; lastWins = []; };
      const center = (r, y) => { const b = reelsEl.getBoundingClientRect(), rr = reels[r].parentNode.getBoundingClientRect(), s = step(); return [rr.left - b.left + rr.width / 2, rr.top - b.top + y * s + (s - 4) / 2]; };
      const drawLines = () => { const b = reelsEl.getBoundingClientRect(); svg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`); svg.innerHTML = lastWins.filter(w => w.line >= 0).map((w, i) => { const c = ['#f3e3b3', '#c7b6ff', '#ff9fb0', '#9cc3ff', '#7fe8bf'][i % 5]; return `<polyline points="${LINES[w.line].map((y, r) => center(r, y).join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" opacity=".9" style="filter:drop-shadow(0 0 5px ${c})"/>`; }).join(''); };
      const showWins = wins => { lastWins = wins; if (!wins.length) return; const hit = new Set(); wins.forEach(w => w.cells.forEach(([r, y]) => hit.add(r + ':' + y))); reels.forEach((s, r) => [...s.children].slice(0, 3).forEach((e, y) => e.classList.add(hit.has(r + ':' + y) ? 'win' : 'dim'))); drawLines(); };
      async function animate(grid, turbo) {
        const st = step(), N = turbo ? 6 : 14;
        await Promise.all(reels.map((strip, r) => new Promise(res => {
          const old = [...strip.children].slice(0, 3).map(e => e.dataset.k); strip.innerHTML = '';
          grid[r].forEach(k => strip.appendChild(symEl(k))); const fill = N + r * (turbo ? 2 : 5);
          for (let i = 0; i < fill; i++) strip.appendChild(symEl(rnd())); old.forEach(k => strip.appendChild(symEl(k)));
          strip.style.transition = 'none'; strip.style.transform = `translateY(${-(fill + 3) * st}px)`; void strip.offsetHeight;
          const dur = (turbo ? .35 : .95) + r * (turbo ? .08 : .2);
          strip.style.transition = `transform ${dur}s cubic-bezier(.18,.72,.25,1.05)`; strip.style.transform = 'translateY(0)';
          setTimeout(() => { sfx('stop'); while (strip.children.length > 3) strip.lastChild.remove(); res(); }, dur * 1000 + 30);
        })));
      }
      async function spin() {
        if (spinning || !alive) return;
        const isFree = free > 0, b = bet.get();
        if (!isFree && b > App.me.bal) { autoLeft = 0; ui(); return toast('게임머니가 부족해요.', true); }
        spinning = true; clearWins(); ui(); $('#sm', el).textContent = isFree ? '✺ FREE SPIN' : '행운을 굴리는 중…';
        if (!isFree) S2.setBal(App.me.bal - b);
        let r;
        try { r = await POST('slot', { bet: b }); } catch (e) { spinning = false; autoLeft = 0; ui(); err(e); S2.refreshMe(); return; }
        const shownBal = r.bal; S2.setBal(shownBal - r.payout, false);
        await animate(r.grid, $('#turbo', el).checked);
        if (!alive) return;
        showWins(r.wins); S2.setBal(shownBal);
        $('#sjp', el).textContent = fmt(r.jackpot);
        if (r.free) {
          free = r.freeLeft; freeTotal = r.freeTotal;
          $('#sm', el).innerHTML = r.payout ? `<span class="gold">+${fmt(r.payout)}G</span>${r.freeSpins ? ' · 프리스핀 +' + r.freeSpins : ''}` : '꽝 · 다음 프리스핀';
          if (r.jackpotWin) S2.bigWin(r.payout, r.payout / r.bet, 'GRAND JACKPOT');
          if (free <= 0) { $('#sm', el).innerHTML = `프리스핀 종료 · 총 <span class="gold">${fmt(freeTotal)}G</span>`; if (freeTotal / r.bet >= 20) S2.bigWin(freeTotal, freeTotal / r.bet); else if (freeTotal) sfx('win'); freeTotal = 0; }
        } else {
          $('#sm', el).innerHTML = r.payout ? `<span class="gold">+${fmt(r.payout)}G</span> · ${r.wins.length}개 당첨` : '아쉽네요 · 한 번 더';
          if (r.jackpotWin) S2.bigWin(r.payout, r.payout / b, 'GRAND JACKPOT'); else winFx(r.payout, b);
          if (r.freeSpins) { free = r.freeLeft; freeTotal = 0; toast(`✺ 후광 강림! 프리스핀 ${r.freeSpins}회`); sfx('big'); }
          if (autoLeft > 0) autoLeft--;
        }
        spinning = false; ui();
        if (free > 0 || autoLeft > 0) {
          const turbo = $('#turbo', el).checked;
          await sleep(r.payout ? (turbo ? 500 : 1100) : (turbo ? 150 : 420));
          while (S2.bigOpen) await sleep(200);
          if (alive) spin();
        }
      }
      $('#spin', el).onclick = () => { sfx('click'); spin(); };
      $('#auto', el).onclick = () => { sfx('click'); if (autoLeft > 0) { autoLeft = 0; ui(); return; } autoLeft = autoN; ui(); spin(); };
      $('#an', el).onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; autoN = +b.dataset.n; $$('#an button', el).forEach(x => x.classList.toggle('on', x === b)); };
      const onResize = () => lastWins.length && drawLines(); addEventListener('resize', onResize);
      slotV = { stop() { alive = false; removeEventListener('resize', onResize); } };
      try { const s = await S2.GET('slot'); free = s.freeLeft; freeTotal = s.freeTotal; $('#sjp', el).textContent = fmt(s.jackpot); ui(); if (free > 0) { toast(`남은 프리스핀 ${free}회를 이어서 돌립니다`); setTimeout(spin, 800); } } catch (e) {}
      ui();
    },
    unmount() { if (slotV) slotV.stop(); slotV = null; }
  });

  // ================= BLACKJACK =================
  register('bj', {
    async mount(el) {
      el.innerHTML = S2.head('bj') + `<div class="felt" id="ft"><div class="lbl">DEALER <span class="score" id="ds">-</span></div><div class="cards" id="dc" style="margin-top:8px"></div>
        <div class="motto">Blackjack pays three to two</div><div class="lbl">YOU</div><div id="ph" style="display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:8px"></div></div>
        <div id="ba"><div id="bb"></div><button class="btn gold wide xl" id="deal" style="margin-top:10px">DEAL</button></div>
        <div class="acts hide" id="acts"><button class="btn emerald" data-a="hit">HIT</button><button class="btn ruby" data-a="stand">STAND</button><button class="btn violet" data-a="double">DOUBLE</button><button class="btn line" data-a="split">SPLIT</button></div>
        <details class="rules"><summary>규칙</summary><div class="panel">딜러는 소프트 17에서 멈춥니다 · 블랙잭 3:2 · 처음 두 장에서 더블 · 같은 값 카드 스플릿 최대 3회 (A 스플릿은 한 장씩) · 이론 환수율 약 99%</div></details>`;
      const bet = betControl($('#bb', el), 'bj', 1000000);
      let shownD = 0, busy = false;
      const label = { blackjack: '<span class="gold">BLACKJACK</span>', win: '<span class="green">WIN</span>', push: 'PUSH', lose: '<span class="red">LOSE</span>', bust: '<span class="red">BUST</span>' };
      function render(g, dealerN) {
        const dc = $('#dc', el); dc.innerHTML = '';
        const dl = dealerN == null ? g.dealer : g.dealer.slice(0, dealerN);
        dl.forEach((c, i) => { const e = card(c, c && i === 1 && shownD < 2 && g.state === 'done' ? 'flip' : ''); if (i < shownD && !(i === 1 && g.state === 'done' && shownD < 2)) e.style.animation = 'none'; dc.appendChild(e); });
        shownD = Math.max(shownD, c2(dl)); function c2(x) { return x.filter(Boolean).length; }
        $('#ds', el).textContent = dl.filter(Boolean).length ? score(dl.filter(Boolean)) : '-';
        $('#ph', el).innerHTML = g.hands.map((h, i) => `<div style="text-align:center;padding:6px;border-radius:14px;${g.state === 'play' && i === g.active && g.hands.length > 1 ? 'box-shadow:inset 0 0 0 1.5px var(--gold);background:rgba(243,227,179,.06)' : ''}"><div class="cards" data-h="${i}"></div><div style="margin-top:6px;font-size:12px;font-weight:700"><span class="score">${h.score.soft && h.score.total < 21 ? h.score.total - 10 + '/' : ''}${h.score.total}</span> ${fmt(h.bet)} ${g.state === 'done' && (dealerN == null || dealerN >= g.dealer.length) && h.result ? label[h.result] : ''}</div></div>`).join('');
        g.hands.forEach((h, i) => { const box = $(`[data-h="${i}"]`, el); h.cards.forEach((c, j) => { const e = card(c); if (j < (render.seen[i] || 0)) e.style.animation = 'none'; box.appendChild(e); }); render.seen[i] = h.cards.length; });
        $('#acts', el).classList.toggle('hide', g.state !== 'play'); $('#ba', el).classList.toggle('hide', g.state === 'play' || busy);
        if (g.state === 'play') { $('[data-a="double"]', el).disabled = !g.canDouble || App.me.bal < g.hands[g.active].bet; $('[data-a="split"]', el).disabled = !g.canSplit || App.me.bal < g.hands[g.active].bet; }
        bet.lock(g.state === 'play' || busy);
      }
      render.seen = [];
      function score(cs) { let t = 0, a = 0; cs.forEach(c => { t += c.r === 'A' ? 11 : ['J', 'Q', 'K', '10'].includes(c.r) ? 10 : +c.r; if (c.r === 'A') a++; }); while (t > 21 && a) { t -= 10; a--; } return t; }
      async function handle(r) {
        const g = r.game; if (!g) return;
        sfx('card');
        if (g.state === 'done') {
          busy = true; render(g, 2); await sleep(500);
          for (let k = 3; k <= g.dealer.length; k++) { sfx('card'); render(g, k); await sleep(520); }
          busy = false; render(g);
          const net = g.payout - g.wagered;
          banner($('#ft', el), net > 0 ? 'WIN' : net === 0 ? 'PUSH' : 'LOSE', (net > 0 ? '+' : '') + fmt(net) + 'G', net > 0 ? '#6ff0bf' : net === 0 ? '#fff' : '#ff8197');
          winFx(g.payout, g.wagered);
        } else render(g);
      }
      $('#deal', el).onclick = async () => { const b = bet.get(); if (b > App.me.bal) return toast('게임머니가 부족해요.', true); shownD = 0; render.seen = []; $$('.banner', el).forEach(x => x.remove()); try { handle(await POST('bj', { action: 'deal', bet: b })); } catch (e) { err(e); } };
      $('#acts', el).onclick = async e => { const b = e.target.closest('[data-a]'); if (!b || b.disabled) return; $$('#acts button', el).forEach(x => x.disabled = true); try { handle(await POST('bj', { action: b.dataset.a })); } catch (er) { err(er); $$('#acts button', el).forEach(x => x.disabled = false); } };
      try { const s = await POST('bj', { action: 'state' }); if (s.game) { shownD = 2; render(s.game); } } catch (e) {}
    }
  });
  function banner(host, t, sub, color) { $$('.banner', host).forEach(b => b.remove()); const b = document.createElement('div'); b.className = 'banner'; b.innerHTML = `<b class="foil">${esc(t)}</b><span style="color:${color}">${esc(sub)}</span>`; host.appendChild(b); setTimeout(() => b.remove(), 2000); }
  S2.banner = banner;

  // ================= PLINKO =================
  const PL = { low: [8, 3, 1.6, 1.3, 1.1, 1, .5, 1, 1.1, 1.3, 1.6, 3, 8], mid: [22, 8, 3, 1.9, 1.2, .7, .3, .7, 1.2, 1.9, 3, 8, 22], high: [150, 24, 8, 2, .7, .2, .2, .2, .7, 2, 8, 24, 150] };
  let plV = null;
  register('plinko', {
    mount(el) {
      el.innerHTML = S2.head('plinko') + `<div class="board"><canvas id="pc"></canvas></div>
        <div class="seg" id="rk" style="margin-top:10px"><button data-r="low">안정</button><button data-r="mid">보통</button><button data-r="high">하이리스크</button></div>
        <div id="pb"></div><div class="row" style="margin-top:10px"><button class="btn gold xl" id="d1" style="flex:2">별 떨어뜨리기</button><button class="btn violet xl" id="d10">×10</button></div>
        <details class="rules"><summary>규칙</summary><div class="panel">12줄의 핀을 지나 떨어진 칸의 배율만큼 받습니다. 가운데일수록 자주, 가장자리일수록 드물게 떨어져요. 이론 환수율 약 98%.</div></details>`;
      const bet = betControl($('#pb', el), 'plinko', 100000);
      const cv = $('#pc', el), cx = cv.getContext('2d'); const R = 12;
      let W, H, gap, top, risk = store.get('plr', 'mid'), balls = [], running = false, flash = {}, alive = true, pend = 0;
      $$('#rk button', el).forEach(b => b.classList.toggle('on', b.dataset.r === risk));
      const pegY = i => top + i * gap * .92, slotY = () => pegY(R - 1) + gap * .95;
      function resize() { W = cv.parentElement.clientWidth || 340; gap = W / (R + 3); top = gap * 1.2; H = top + gap * (R - 1) + gap * 2.1; cv.style.height = H + 'px'; cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio; draw(); }
      const col = m => m >= 20 ? '#e0506d' : m >= 5 ? '#e07a2f' : m >= 2 ? '#d6a43a' : m >= 1 ? '#b8973c' : m >= .5 ? '#56606e' : '#3d4452';
      function rr(x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
      function draw() {
        const d = devicePixelRatio; cx.setTransform(d, 0, 0, d, 0, 0); cx.clearRect(0, 0, W, H); const c = W / 2, now = performance.now();
        for (let i = 0; i < R; i++) for (let j = 0; j < i + 3; j++) { cx.beginPath(); cx.arc(c + (j - (i + 2) / 2) * gap, pegY(i), Math.max(2.4, gap * .085), 0, 7); cx.fillStyle = '#f3e9d2'; cx.shadowColor = '#d6b26a'; cx.shadowBlur = 6; cx.fill(); cx.shadowBlur = 0; }
        PL[risk].forEach((m, k) => { const x = c + (k - R / 2) * gap, f = flash[k] && now - flash[k] < 420 ? 1 - (now - flash[k]) / 420 : 0, w = gap * .9, h = gap * .78, y = slotY() + f * 6; cx.fillStyle = col(m); rr(x - w / 2, y, w, h, 6); cx.fill(); cx.fillStyle = '#fff'; cx.font = `800 ${Math.max(8, Math.min(12, gap * .3))}px Pretendard,sans-serif`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(m + '×', x, y + h / 2); });
        for (const b of balls) { cx.beginPath(); cx.arc(b.x, b.y, Math.max(4, gap * .2), 0, 7); const g = cx.createRadialGradient(b.x - 2, b.y - 2, 1, b.x, b.y, gap * .2); g.addColorStop(0, '#fff'); g.addColorStop(1, '#d6b26a'); cx.fillStyle = g; cx.shadowColor = '#fff3cf'; cx.shadowBlur = 14; cx.fill(); cx.shadowBlur = 0; }
      }
      function pos(b, now) {
        const seg = 105, k = (now - b.t0) / seg, i = Math.floor(k), s = k - i, c = W / 2; if (k < 0) return [c, pegY(0) - gap];
        const off = j => { let o = 0; for (let q = 0; q < j; q++) o += b.path[q] ? .5 : -.5; return o; };
        if (i === 0) return [c, pegY(0) - gap + gap * s * s];
        if (i <= R) { const o0 = off(i - 1), o1 = off(i), y0 = pegY(i - 1) - gap * .3, y1 = i < R ? pegY(i) - gap * .3 : slotY() + gap * .2; return [c + (o0 + (o1 - o0) * s) * gap, y0 + (y1 - y0) * s * s - gap * .2 * 4 * s * (1 - s)]; }
        return null;
      }
      function loop() {
        if (!alive) return; const now = performance.now();
        balls = balls.filter(b => { const p = pos(b, now); if (!p) { flash[b.slot] = now; S2.setBal(App.me.bal + b.payout); if (b.mult >= 20) S2.bigWin(b.payout, b.mult); else if (b.payout > b.bet) sfx('win'); return false; } const li = Math.floor((now - b.t0) / 105); if (li !== b.li) { b.li = li; if (li > 0 && li <= R) sfx('tick'); } b.x = p[0]; b.y = p[1]; return true; });
        draw();
        if (balls.length || Object.values(flash).some(t => now - t < 420)) requestAnimationFrame(loop); else { running = false; if (!pend) S2.refreshMe(); }
      }
      async function drop(count) {
        const b = bet.get(); if (b * count > App.me.bal) return toast('게임머니가 부족해요.', true);
        pend++;
        try {
          const r = await POST('plinko', { bet: b, risk, count }); const finalBal = r.bal;
          S2.setBal(finalBal - r.drops.reduce((a, d) => a + d.payout, 0) - balls.reduce((a, x) => a + x.payout, 0));
          r.drops.forEach((d, i) => balls.push({ ...d, bet: b, t0: performance.now() + i * 170, x: W / 2, y: 0, li: -1 }));
          if (!running) { running = true; requestAnimationFrame(loop); }
        } catch (e) { err(e); } finally { pend--; }
      }
      $('#d1', el).onclick = () => { sfx('click'); drop(1); };
      $('#d10', el).onclick = () => { sfx('click'); drop(10); };
      $('#rk', el).onclick = e => { const b = e.target.closest('[data-r]'); if (!b || balls.length) return; risk = b.dataset.r; store.set('plr', risk); $$('#rk button', el).forEach(x => x.classList.toggle('on', x === b)); draw(); };
      requestAnimationFrame(resize); addEventListener('resize', resize);
      plV = { stop() { alive = false; removeEventListener('resize', resize); } };
    },
    unmount() { if (plV) plV.stop(); }
  });

  // ================= HI-LO =================
  const RK = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const toC = c => ({ r: RK[c.v - 1], s: c.s });
  register('hilo', {
    async mount(el) {
      el.innerHTML = S2.head('hilo') + `<div class="felt amber" id="hf"><div class="lbl">HI-LO LADDER</div><div class="hl-stage" id="hs"></div><div class="bigx foil" id="hm">×1.00</div><div class="motto" id="hi">베팅 후 시작을 누르세요</div><div class="trail" id="ht"></div></div>
        <div id="hb"><div id="hbet"></div><button class="btn gold wide xl" id="hstart" style="margin-top:10px">시작</button></div>
        <div id="ha" class="hide"><div class="row" style="margin-top:12px"><button class="btn emerald" id="hhi" style="height:64px;flex-direction:column;gap:1px"><span>▲ 높거나 같음</span><small id="hhx" style="font-size:12px;opacity:.85"></small></button><button class="btn ruby" id="hlo" style="height:64px;flex-direction:column;gap:1px"><span>▼ 낮거나 같음</span><small id="hlx" style="font-size:12px;opacity:.85"></small></button></div>
        <div class="row" style="margin-top:8px"><button class="btn dark" id="hsk">카드 넘기기</button><button class="btn gold" id="hc" style="flex:1.6">회수</button></div></div>
        <details class="rules"><summary>규칙</summary><div class="panel">A가 가장 낮고 K가 가장 높습니다. 다음 카드가 지금보다 높거나 같을지, 낮거나 같을지 맞혀 보세요. 맞힐 때마다 확률에 맞춘 배율이 곱해지고 언제든 회수할 수 있어요. 넘기기는 한 판에 3번. 이론 환수율 97%.</div></details>`;
      const bet = betControl($('#hbet', el), 'hilo', 1000000);
      let g = null;
      function render(game, extra) {
        g = game; const st = $('#hs', el); st.innerHTML = '';
        $('#ha', el).classList.toggle('hide', !g); $('#hb', el).classList.toggle('hide', !!g); bet.lock(!!g);
        if (!g) { if (extra && extra.card) st.appendChild(card(toC(extra.card), 'flip')); else st.appendChild(card(null)); return; }
        st.appendChild(card(toC(g.cur), 'flip'));
        $('#hm', el).textContent = '×' + g.mult.toFixed(2);
        $('#ht', el).innerHTML = g.trail.map(c => `<i class="${c.s === '♥' || c.s === '♦' ? 'r' : ''}">${RK[c.v - 1]}${c.s}</i>`).join('');
        const p = v => Math.round(v * 100);
        $('#hhx', el).textContent = g.hi ? `×${g.hi.toFixed(2)} · ${p((14 - g.cur.v) / 13)}%` : '확정 · 선택 불가'; $('#hhi', el).disabled = !g.hi;
        $('#hlx', el).textContent = g.lo ? `×${g.lo.toFixed(2)} · ${p(g.cur.v / 13)}%` : '확정 · 선택 불가'; $('#hlo', el).disabled = !g.lo;
        $('#hsk', el).textContent = `카드 넘기기 (${3 - g.skips})`; $('#hsk', el).disabled = g.skips >= 3;
        $('#hc', el).disabled = g.mult <= 1; $('#hc', el).textContent = g.mult > 1 ? `회수 · ${fmt(g.bet * g.mult)}G` : '회수';
        $('#hi', el).textContent = g.mult > 1 ? '연속 적중 중 · 다음 카드는?' : '다음 카드는 높을까, 낮을까?';
      }
      const lock = b => $$('#ha button', el).forEach(x => { if (b) x.disabled = true; });
      $('#hstart', el).onclick = async () => { try { const r = await POST('hilo', { action: 'start', bet: bet.get() }); sfx('card'); $('#hm', el).style.color = ''; render(r.game); } catch (e) { err(e); } };
      const guess = async a => {
        lock(true);
        try {
          const r = await POST('hilo', { action: a }); sfx('card');
          if (r.lost) { const b = g.bet; render(null, { card: r.card }); $('#hm', el).textContent = '×' + r.mult.toFixed(2); $('#ht', el).innerHTML = r.trail.map(c => `<i class="${c.s === '♥' || c.s === '♦' ? 'r' : ''}">${RK[c.v - 1]}${c.s}</i>`).join(''); $('#hi', el).innerHTML = `<span class="red">미끄러졌어요 · -${fmt(b)}G</span>`; sfx('lose'); }
          else render(r.game);
        } catch (e) { err(e); render(g); }
      };
      $('#hhi', el).onclick = () => guess('hi'); $('#hlo', el).onclick = () => guess('lo');
      $('#hsk', el).onclick = async () => { try { const r = await POST('hilo', { action: 'skip' }); sfx('card'); render(r.game); } catch (e) { err(e); } };
      $('#hc', el).onclick = async () => { try { const b = g.bet, cur = g.cur; const r = await POST('hilo', { action: 'cash' }); render(null, { card: cur }); $('#hi', el).innerHTML = `<span class="green">+${fmt(r.cashed - b)}G 회수 성공</span>`; winFx(r.cashed, b); } catch (e) { err(e); } };
      try { const s = await POST('hilo', { action: 'state' }); render(s.game); } catch (e) { render(null); }
    }
  });

  // ================= MINES =================
  register('mines', {
    async mount(el) {
      el.innerHTML = S2.head('mines') + `<div class="mines" id="mg">${Array.from({ length: 25 }, (_, i) => `<button class="tile" data-i="${i}" disabled></button>`).join('')}</div>
        <div class="mstat"><span class="muted">현재 <b class="foil" id="mx">×1.00</b></span><span class="muted">다음 <b id="mn">-</b></span></div>
        <div id="mb"><div class="field"><span>지뢰 개수</span><div class="seg" id="mc" style="flex:1">${[1, 3, 5, 10, 20].map(n => `<button data-m="${n}">${n}</button>`).join('')}</div></div><div id="mbet"></div><button class="btn gold wide xl" id="ms" style="margin-top:10px">게임 시작</button></div>
        <button class="btn emerald wide xl hide" id="mcash" style="margin-top:12px">회수</button>
        <details class="rules"><summary>규칙</summary><div class="panel">25칸 중 지뢰가 숨어 있어요. 보석 칸을 열 때마다 배율이 올라가고, 언제든 회수할 수 있습니다. 지뢰를 밟으면 베팅금을 잃어요. 지뢰가 많을수록 배율이 가파르게 오릅니다. 이론 환수율 97%.</div></details>`;
      const bet = betControl($('#mbet', el), 'mines', 100000);
      let m = store.get('minesN', 3), g = null;
      const mult = (mm, k) => { let x = .97; for (let i = 0; i < k; i++) x *= (25 - i) / (25 - mm - i); return Math.floor(x * 100) / 100; };
      const segUI = () => $$('#mc button', el).forEach(b => b.classList.toggle('on', +b.dataset.m === m));
      segUI();
      $('#mc', el).onclick = e => { const b = e.target.closest('[data-m]'); if (!b || g) return; m = +b.dataset.m; store.set('minesN', m); segUI(); $('#mn', el).textContent = '×' + mult(m, 1).toFixed(2); };
      $('#mn', el).textContent = '×' + mult(m, 1).toFixed(2);
      function render(game, reveal) {
        g = game; $('#mb', el).classList.toggle('hide', !!g); $('#mcash', el).classList.toggle('hide', !g); bet.lock(!!g);
        $$('.tile', el).forEach((t, i) => {
          t.className = 'tile'; t.textContent = ''; t.disabled = !g;
          if (g && g.picked.includes(i)) { t.classList.add('gem'); t.textContent = '💎'; t.disabled = true; }
          if (reveal) { if (reveal.mines.includes(i)) { t.classList.add(i === reveal.boom ? 'bomb' : 'ghost'); t.textContent = '💣'; } else if (reveal.picked.includes(i)) { t.classList.add('gem'); t.textContent = '💎'; } else { t.classList.add('ghost'); t.textContent = '💎'; } t.disabled = true; }
        });
        if (g) { $('#mx', el).textContent = '×' + g.mult.toFixed(2); $('#mn', el).textContent = '×' + g.next.toFixed(2); $('#mcash', el).disabled = !g.picked.length; $('#mcash', el).textContent = g.picked.length ? `회수 · ${fmt(g.bet * g.mult)}G` : '보석을 하나 이상 찾아 주세요'; }
      }
      $('#ms', el).onclick = async () => { try { const r = await POST('mines', { action: 'start', bet: bet.get(), mines: m }); sfx('click'); render(r.game); } catch (e) { err(e); } };
      $('#mg', el).onclick = async e => {
        const t = e.target.closest('.tile'); if (!t || t.disabled || !g) return; t.disabled = true;
        try {
          const b = g.bet; const r = await POST('mines', { action: 'pick', cell: +t.dataset.i });
          if (r.boom !== undefined) { sfx('boom'); render(null, r); $('#mx', el).innerHTML = `<span class="red">폭발 · -${fmt(b)}G</span>`; }
          else if (r.cleared) { render(null, r); winFx(r.cashed, b); $('#mx', el).textContent = '×' + r.mult.toFixed(2); }
          else { sfx('pop'); render(r.game); }
        } catch (er) { err(er); t.disabled = false; }
      };
      $('#mcash', el).onclick = async () => { try { const b = g.bet; const r = await POST('mines', { action: 'cash' }); render(null, r); $('#mx', el).textContent = '×' + r.mult.toFixed(2); toast(`+${fmt(r.cashed - b)}G 회수`); winFx(r.cashed, b); } catch (e) { err(e); } };
      try { const s = await POST('mines', { action: 'state' }); render(s.game); } catch (e) { render(null); }
    }
  });

  // ================= DICE =================
  register('dice', {
    mount(el) {
      el.innerHTML = S2.head('dice') + `<div class="panel deco" style="text-align:center"><div class="muted" style="font-size:10px;letter-spacing:.3em">ROLL</div><div class="dice-num foil" id="dn">50.00</div>
        <div class="slider"><div class="trk" id="dt"><i></i><i></i></div><input type="range" id="dr" min="2" max="96" step="1"><span class="mark hide" id="dm"></span></div>
        <div class="seg" id="dd" style="margin-top:6px"><button data-o="0">언더 (이하)</button><button data-o="1">오버 (초과)</button></div>
        <div class="dstat"><div><small>목표</small><b id="dtg"></b></div><div><small>당첨 확률</small><b id="dch"></b></div><div><small>배율</small><b class="gold" id="dmu"></b></div></div></div>
        <div id="dbet"></div><div class="row" style="margin-top:10px"><button class="btn gold xl" id="dgo" style="flex:2">굴리기</button><button class="btn violet xl" id="dauto">×10</button></div>
        <details class="rules"><summary>규칙</summary><div class="panel">0.00 ~ 99.99 사이 숫자가 나옵니다. 목표값보다 낮게(언더) 또는 높게(오버) 나오면 승리. 확률이 낮을수록 배율이 커져요. 배율 = 99 ÷ 확률. 이론 환수율 99%.</div></details>`;
      const bet = betControl($('#dbet', el), 'dice', 100000);
      let t = store.get('diceT', 50), over = store.get('diceO', false), rolling = false;
      const calc = () => { const ch = over ? (99.99 - t) / 100 : t / 100; return { ch, mu: Math.floor(.99 / ch * 10000) / 10000 }; };
      function ui() {
        $('#dr', el).value = t; const { ch, mu } = calc();
        const [a, b] = $$('#dt i', el); a.style.width = t + '%'; b.style.width = (100 - t) + '%';
        a.style.background = over ? '#3a3346' : 'linear-gradient(90deg,#1c9a70,#5fe0b0)'; b.style.background = over ? 'linear-gradient(90deg,#5fe0b0,#1c9a70)' : '#3a3346';
        $('#dtg', el).textContent = (over ? '> ' : '< ') + t; $('#dch', el).textContent = (ch * 100).toFixed(2) + '%'; $('#dmu', el).textContent = '×' + mu.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
        $$('#dd button', el).forEach(x => x.classList.toggle('on', (+x.dataset.o === 1) === over));
      }
      $('#dr', el).oninput = e => { t = +e.target.value; store.set('diceT', t); ui(); };
      $('#dd', el).onclick = e => { const b = e.target.closest('[data-o]'); if (!b) return; over = b.dataset.o === '1'; store.set('diceO', over); ui(); };
      async function roll() {
        const b = bet.get(); if (b > App.me.bal) { toast('게임머니가 부족해요.', true); return false; }
        rolling = true; bet.lock(true);
        try {
          const r = await POST('dice', { bet: b, target: t, over });
          const n = $('#dn', el), t0 = performance.now();
          await new Promise(res => { (function a(now) { const p = Math.min(1, (now - t0) / 450); n.textContent = p < 1 ? (Math.random() * 99.99).toFixed(2) : r.roll.toFixed(2); if (p < 1) requestAnimationFrame(a); else res(); })(t0); });
          n.style.color = r.win ? '#6ff0bf' : '#ff8197'; n.classList.remove('foil');
          const mk = $('#dm', el); mk.classList.remove('hide'); mk.style.left = r.roll + '%'; mk.textContent = r.roll.toFixed(2);
          setTimeout(() => { n.style.color = ''; n.classList.add('foil'); }, 900);
          winFx(r.payout, b); return true;
        } catch (e) { err(e); return false; } finally { rolling = false; bet.lock(false); }
      }
      $('#dgo', el).onclick = () => !rolling && roll();
      $('#dauto', el).onclick = async () => { if (rolling) return; for (let i = 0; i < 10; i++) { if (!(await roll())) break; await sleep(350); } };
      ui();
    }
  });

  // ================= VIDEO POKER =================
  const VP = [['로열 플러시', 800], ['스트레이트 플러시', 50], ['포카드', 25], ['풀하우스', 8], ['플러시', 5], ['스트레이트', 4], ['트리플', 3], ['투페어', 2], ['잭 이상 원페어', 1]];
  register('vpoker', {
    async mount(el) {
      el.innerHTML = S2.head('vpoker') + `<div class="vp-pay" id="vpp">${VP.map((p, i) => `<span data-r="${i}">${p[0]}</span><span data-r="${i}" class="num">×${p[1]}</span>`).join('')}</div>
        <div class="felt navy" style="margin-top:10px;min-height:0;padding:10px"><div class="vp-hand" id="vh"></div><div class="motto" id="vm">DEAL을 눌러 시작하세요</div></div>
        <div id="vb"></div><button class="btn gold wide xl" id="vgo" style="margin-top:10px">DEAL</button>
        <details class="rules"><summary>규칙</summary><div class="panel">잭스 오어 베터(8/5). 다섯 장을 받고, 남길 카드를 눌러 HOLD한 뒤 DRAW 하면 나머지를 바꿉니다. 최종 패에 따라 배당이 지급돼요. 이론 환수율 약 97%.</div></details>`;
      const bet = betControl($('#vb', el), 'vpoker', 100000);
      let hand = null, holds = [false, false, false, false, false], phase = 'idle';
      function render(cards, anim) {
        const h = $('#vh', el); h.innerHTML = '';
        (cards || [null, null, null, null, null]).forEach((c, i) => { const s = document.createElement('div'); s.className = 'slotc'; const e = card(c, holds[i] && phase === 'held' ? 'h' : ''); if (!anim || (anim === 'draw' && holds[i])) e.style.animation = 'none'; else e.style.animationDelay = (i * 70) + 'ms'; s.appendChild(e); const lab = document.createElement('div'); lab.className = 'held'; lab.textContent = holds[i] && phase === 'held' ? 'HOLD' : ''; s.appendChild(lab); s.onclick = () => { if (phase !== 'held') return; holds[i] = !holds[i]; sfx('click'); render(hand); }; h.appendChild(s); });
        $('#vgo', el).textContent = phase === 'held' ? 'DRAW' : 'DEAL'; bet.lock(phase === 'held');
      }
      const hl = r => $$('#vpp span', el).forEach(s => s.classList.toggle('on', +s.dataset.r === r));
      $('#vgo', el).onclick = async () => {
        const b = $('#vgo', el); b.disabled = true;
        try {
          if (phase !== 'held') {
            const r = await POST('vpoker', { action: 'deal', bet: bet.get() }); hand = r.game.hand; holds = [false, false, false, false, false]; phase = 'held'; sfx('card');
            render(hand, 'deal'); hl(-1); $('#vm', el).textContent = r.hint ? `지금 패: ${r.hint} · 남길 카드를 누르세요` : '남길 카드를 눌러 HOLD 하세요';
          } else {
            const bb = bet.get(); const r = await POST('vpoker', { action: 'draw', holds }); phase = 'idle'; hand = r.hand; sfx('card'); render(hand, 'draw'); hl(r.rank);
            $('#vm', el).innerHTML = r.result ? `<span class="gold">${r.result}</span> · +${fmt(r.payout)}G` : '노 핸드';
            winFx(r.payout, bb);
          }
        } catch (e) { err(e); } finally { b.disabled = false; }
      };
      render(null);
      try { const s = await POST('vpoker', { action: 'state' }); if (s.game) { hand = s.game.hand; phase = 'held'; render(hand); $('#vm', el).textContent = '이어서 진행 · 남길 카드를 누르세요'; } } catch (e) {}
    }
  });
})();
