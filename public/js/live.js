/* Shared live rounds: Rocket Live (crash) and Baccarat Live */
(function () {
  'use strict';
  const { $, $$, esc, fmt, full, App, GET, POST, toast, sfx, register, betControl, chipPicker, card, poller, syncClock, now, rxBind, rxShow, store, winFx } = S2;
  const err = e => toast(e.message, true);
  const LIVE = '<span class="live"><i></i>LIVE</span>';

  // ================= CRASH =================
  let crV = null;
  register('crash', {
    mount(el) {
      el.innerHTML = S2.head('crash', LIVE) + `<div class="hist" id="ch"></div>
        <div class="sky" id="sky"><canvas id="cc"></canvas><div class="m" id="cm">1.00×</div><div class="s" id="cs">연결 중…</div></div>
        <div id="cb"></div>
        <div class="field"><span style="flex:0 0 auto">자동 회수</span><input type="number" id="ca" min="1.01" step="0.01" placeholder="예: 2.00 (비우면 수동)"><span style="flex:0 0 auto">×</span></div>
        <button class="btn gold wide xl" id="cgo" style="margin-top:10px">탑승하기</button>
        <label class="tog" style="margin-top:10px"><input type="checkbox" id="cq"><i></i>매 판 자동 탑승</label>
        <div class="sec"><h2>Passengers</h2><small id="cpn">이번 판 탑승객</small><div class="rule"></div></div><div class="plist" id="cp"></div>
        <details class="rules"><summary>규칙</summary><div class="panel">모든 플레이어가 같은 로켓에 탑니다. 7초 동안 탑승(베팅)을 받고, 이륙하면 배율이 1.00×부터 오릅니다. 폭발 전에 회수하면 베팅 × 배율을 받아요. 폭발하면 회수하지 못한 베팅은 사라집니다. 약 3%는 이륙 직후 폭발 · 최대 1000× · 이론 환수율 97%.</div></details>`;
      const bet = betControl($('#cb', el), 'crash', 1000000);
      $('#ca', el).value = store.get('crashAuto', '');
      $('#ca', el).onchange = e => store.set('crashAuto', e.target.value);
      $('#cq', el).checked = store.get('crashQ', false); $('#cq', el).onchange = e => store.set('crashQ', e.target.checked);
      const cv = $('#cc', el), cx = cv.getContext('2d'); let W = 0, H = 0;
      let st = null, alive = true, since = 0, my = null, boomShown = 0, lastPhase = '', parts = [], tickN = -1, autoBetRound = 0;
      const K = .11, mAt = ms => Math.exp(K * ms / 1000), tAt = m => Math.log(m) / K * 1000;
      function resize() { const r = cv.getBoundingClientRect(); W = r.width; H = r.height; cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio; }
      function draw(m, tms, crashed) {
        const d = devicePixelRatio; cx.setTransform(d, 0, 0, d, 0, 0); cx.clearRect(0, 0, W, H);
        const pad = 26, t = tms / 1000, tMax = Math.max(8, t * 1.15), mMax = Math.max(2, m * 1.25);
        const X = tt => pad + tt / tMax * (W - pad * 2), Y = mm => H - pad - (mm - 1) / (mMax - 1) * (H - pad * 2);
        cx.strokeStyle = 'rgba(243,227,179,.07)'; cx.fillStyle = 'rgba(243,227,179,.4)'; cx.font = '10px Pretendard,sans-serif'; cx.lineWidth = 1;
        const stp = mMax <= 3 ? .5 : mMax <= 10 ? 2 : mMax <= 50 ? 10 : mMax <= 200 ? 50 : 200;
        for (let v = 1; v <= mMax; v += stp) { const y = Y(v); cx.beginPath(); cx.moveTo(pad, y); cx.lineTo(W - 8, y); cx.stroke(); cx.fillText(v.toFixed(v < 10 ? 1 : 0) + '×', 2, y - 2); }
        if (tms <= 0) { rocket(X(0), Y(1), -Math.PI / 4); return; }
        const g = cx.createLinearGradient(0, H, W, 0); g.addColorStop(0, '#7354e6'); g.addColorStop(1, crashed ? '#ff6b84' : '#f3e3b3');
        cx.beginPath(); cx.moveTo(X(0), Y(1)); for (let i = 1; i <= 60; i++) { const tt = t * i / 60; cx.lineTo(X(tt), Y(Math.min(m, mAt(tt * 1000)))); }
        cx.lineWidth = 3.5; cx.strokeStyle = g; cx.shadowColor = '#c7b6ff'; cx.shadowBlur = 14; cx.stroke(); cx.shadowBlur = 0;
        cx.lineTo(X(t), H - pad); cx.lineTo(X(0), H - pad); cx.closePath(); const fg = cx.createLinearGradient(0, 0, 0, H); fg.addColorStop(0, 'rgba(155,123,255,.28)'); fg.addColorStop(1, 'rgba(155,123,255,0)'); cx.fillStyle = fg; cx.fill();
        if (my && my.cashed > 0) { const y = Y(my.cashed); cx.setLineDash([4, 4]); cx.strokeStyle = '#6ff0bf'; cx.beginPath(); cx.moveTo(pad, y); cx.lineTo(W - 8, y); cx.stroke(); cx.setLineDash([]); }
        // other players' cash-out markers
        if (st) st.bets.forEach(b => { if (b.cashed > 0 && b.cashed <= m) { const x = X(tAt(b.cashed) / 1000), y = Y(b.cashed); cx.fillStyle = b.me ? '#6ff0bf' : 'rgba(243,227,179,.85)'; cx.beginPath(); cx.arc(x, y, 3, 0, 7); cx.fill(); cx.font = '600 10px Pretendard,sans-serif'; cx.fillText(b.nick, x + 5, y - 5); } });
        const ang = Math.atan2(Y(Math.min(m, mAt(tms))) - Y(Math.min(m, mAt(Math.max(0, tms - 50)))), X(t) - X(t - .05));
        if (!crashed) rocket(X(t), Y(m), ang);
        parts = parts.filter(p => p.l > 0); parts.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .15; p.l -= .022; cx.globalAlpha = Math.max(0, p.l); cx.fillStyle = p.c; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill(); }); cx.globalAlpha = 1;
        if (crashed && boomShown && performance.now() - boomShown < 60) { for (let i = 0; i < 46; i++) parts.push({ x: X(t), y: Y(m), vx: (Math.random() - .5) * 7, vy: (Math.random() - .7) * 6, r: Math.random() * 3 + 1.5, l: 1, c: ['#ff6b84', '#f3c46a', '#fff'][i % 3] }); }
      }
      function rocket(x, y, a) { cx.save(); cx.translate(x, y); cx.rotate(a + Math.PI / 4); cx.font = '30px serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('🚀', 0, 0); cx.restore(); }
      function frame() {
        if (!alive) return; requestAnimationFrame(frame);
        if (!st) return; const r = st.round, n = now(), m = $('#cm', el), s = $('#cs', el), btn = $('#cgo', el);
        my = st.bets.find(b => b.me) || null;
        if (r.phase === 'bet' && n < r.flyAt) {
          const left = Math.max(0, (r.flyAt - n) / 1000);
          m.className = 'm'; m.textContent = left.toFixed(1) + 's'; s.textContent = `#${r.n} 탑승 마감까지 · ${st.bets.length}명 탑승`;
          draw(1, 0, false);
          if (my) { btn.className = 'btn line wide xl'; btn.textContent = `탑승 완료 · ${fmt(my.amount)}G`; btn.disabled = true; }
          else { btn.className = 'btn gold wide xl'; btn.textContent = `탑승하기 · ${fmt(bet.get())}G`; btn.disabled = false; }
          bet.lock(!!my);
        } else if (r.phase !== 'end') {
          const tms = Math.max(0, n - r.flyAt), cur = mAt(tms);
          const mm = Math.floor(cur * 100) / 100;
          if (my && my.cashed > 0) { m.className = 'm ok'; m.textContent = mm.toFixed(2) + '×'; s.textContent = `${my.cashed.toFixed(2)}×에서 회수 · +${fmt(my.payout - my.amount)}G`; }
          else { m.className = 'm'; m.textContent = mm.toFixed(2) + '×'; s.textContent = my ? '원할 때 회수!' : '비행 중 · 다음 판을 기다려 주세요'; }
          const tk = Math.floor(tms / 250); if (tk !== tickN) { tickN = tk; if (my && !my.cashed) sfx('tick'); }
          draw(cur, tms, false);
          if (my && my.cashed === 0) { btn.className = 'btn emerald wide xl'; btn.textContent = `회수 · ${fmt(my.amount * mm)}G`; btn.disabled = false; }
          else { btn.className = 'btn dark wide xl'; btn.textContent = my ? '회수 완료' : '다음 판 탑승 대기'; btn.disabled = true; }
          bet.lock(true);
        } else {
          const p = r.point, tms = tAt(p);
          if (lastPhase !== 'end') { boomShown = performance.now(); sfx('boom'); }
          m.className = 'm boom'; m.textContent = p.toFixed(2) + '×';
          s.textContent = my ? (my.cashed > 0 ? `${my.cashed.toFixed(2)}× 회수 성공 · +${fmt(my.payout - my.amount)}G` : `폭발! -${fmt(my.amount)}G`) : `${p.toFixed(2)}×에서 폭발 · 곧 다음 판`;
          draw(p, tms, true);
          btn.className = 'btn dark wide xl'; btn.textContent = '다음 판 준비 중…'; btn.disabled = true; bet.lock(false);
        }
        if (lastPhase === 'end' && r.phase === 'bet' && $('#cq', el).checked && autoBetRound !== r.n && !my) { autoBetRound = r.n; place(); }
        lastPhase = r.phase;
      }
      function renderSide() {
        $('#ch', el).innerHTML = st.hist.map(p => `<span class="${p < 1.5 ? 'lo' : p < 3 ? 'md' : p < 20 ? 'hi' : 'xx'}">${p.toFixed(2)}×</span>`).join('') || '<span class="muted">기록 없음</span>';
        $('#cpn', el).textContent = `#${st.round.n} 탑승객 ${st.bets.length}명`;
        const ended = st.round.phase === 'end';
        $('#cp', el).innerHTML = st.bets.length ? st.bets.map(b => `<div class="pl ${b.me ? 'me' : ''}" data-uid="${esc(b.uid)}" style="position:relative"><div class="nm">${esc(b.nick)}</div><div class="v">${fmt(b.amount)}</div><div class="v" style="min-width:86px;text-align:right">${b.cashed > 0 ? `<span class="green">${b.cashed.toFixed(2)}× +${fmt(b.payout - b.amount)}</span>` : b.cashed < 0 || ended ? '<span class="red">폭발</span>' : '<span class="muted">비행 중</span>'}</div></div>`).join('') : '<div class="empty">아직 탑승객이 없어요. 첫 번째로 타 보세요!</div>';
      }
      let prevMyCash = 0, prevRound = 0;
      async function poll() {
        const r = await GET('crash?since=' + since); syncClock(r.now);
        if (prevRound && r.round.n !== prevRound) prevMyCash = 0; prevRound = r.round.n;
        st = r; rxShow(r.reacts); if (r.reacts.length) since = Math.max(since, ...r.reacts.map(x => x.ts));
        const me = r.bets.find(b => b.me);
        if (me && me.cashed > 0 && !prevMyCash) { prevMyCash = me.cashed; winFx(me.payout, me.amount); S2.refreshMe(); }
        if (r.round.phase === 'end' && me && me.cashed <= 0 && lastPhase !== 'end') S2.refreshMe();
        renderSide();
      }
      async function place() {
        const b = bet.get(); if (b > App.me.bal) return toast('게임머니가 부족해요.', true);
        const a = parseFloat($('#ca', el).value);
        if ($('#ca', el).value && !(a >= 1.01 && a <= 1000)) return toast('자동 회수는 1.01× ~ 1000×', true);
        try { await POST('crash/bet', { bet: b, auto: a || 0 }); sfx('chip'); pl.now(); } catch (e) { err(e); }
      }
      $('#cgo', el).onclick = async () => {
        if (!st) return; const r = st.round;
        if (r.phase === 'bet' && now() < r.flyAt) return place();
        if (my && my.cashed === 0) { $('#cgo', el).disabled = true; try { const x = await POST('crash/cashout'); my.cashed = x.mult; my.payout = x.payout; prevMyCash = x.mult; winFx(x.payout, my.amount); pl.now(); } catch (e) { err(e); } }
      };
      const pl = poller(poll, () => !st ? 1000 : st.round.phase === 'fly' || (st.round.phase === 'bet' && now() > st.round.flyAt - 300) ? 500 : st.round.phase === 'end' ? 900 : 1000);
      document.addEventListener('rxsent', pl.now);
      rxBind('crash', uid => { const row = $(`#cp [data-uid="${CSS.escape(uid)}"]`, el); return row; });
      requestAnimationFrame(() => { resize(); frame(); }); addEventListener('resize', resize);
      crV = { stop() { alive = false; pl.stop(); removeEventListener('resize', resize); document.removeEventListener('rxsent', pl.now); } };
    },
    unmount() { if (crV) crV.stop(); crV = null; }
  });

  // ================= BACCARAT =================
  let bacV = null;
  register('bac', {
    mount(el) {
      el.innerHTML = S2.head('bac', LIVE) + `<div class="felt ruby" id="bt">
        <div class="timer"><span id="btm">-</span><div class="bar"><i id="bbar"></i></div><span id="brn" class="muted"></span></div>
        <div class="bac-hands"><div class="side" id="sP"><div class="who" style="color:#9cc3ff">PLAYER <span class="score" id="pS">-</span></div><div class="cards" id="pC" style="margin-top:8px"></div></div>
        <div class="side" id="sB"><div class="who" style="color:#ff9fb0">BANKER <span class="score" id="bS">-</span></div><div class="cards" id="bC" style="margin-top:8px"></div></div></div>
        <div class="spots"><button class="spot p" data-s="player"><b>PLAYER</b><small>1 : 1</small><span class="pool"></span><span class="mine"></span></button><button class="spot t" data-s="tie"><b>TIE</b><small>8 : 1</small><span class="pool"></span><span class="mine"></span></button><button class="spot b" data-s="banker"><b>BANKER</b><small>0.95 : 1</small><span class="pool"></span><span class="mine"></span></button></div>
        <div class="spots side"><button class="spot p" data-s="ppair"><b>P PAIR</b><small>11 : 1</small><span class="pool"></span><span class="mine"></span></button><button class="spot b" data-s="bpair"><b>B PAIR</b><small>11 : 1</small><span class="pool"></span><span class="mine"></span></button></div></div>
        <div class="muted" style="font-size:12px;margin:12px 2px 0">칩을 고르고 칸을 누르면 바로 베팅돼요 · 베팅 시간 15초</div><div id="bch"></div>
        <div class="sec"><h2>Road</h2><small id="bst"></small><div class="rule"></div></div><div class="road" id="brd"></div>
        <div class="sec"><h2>Table</h2><small id="bpn">이번 판 참가자</small><div class="rule"></div></div><div class="plist" id="bpl"></div>
        <details class="rules"><summary>규칙</summary><div class="panel">8덱 표준 바카라 · 모든 플레이어가 같은 판에 베팅합니다. 플레이어 1:1, 뱅커 0.95:1(커미션 5%), 타이 8:1(타이면 플레이어·뱅커 베팅은 환불), 페어 11:1. 한 판에 플레이어와 뱅커 양쪽에 걸 수는 없어요.</div></details>`;
      const chip = chipPicker($('#bch', el), 'bac', 1000000);
      let st = null, alive = true, since = 0, shownRound = 0, revealed = 0, resultShown = 0;
      const SP = { player: 'P', banker: 'B', tie: 'T', ppair: 'P', bpair: 'B' };
      const val = c => ['10', 'J', 'Q', 'K'].includes(c.r) ? 0 : c.r === 'A' ? 1 : +c.r;
      const sc = cs => cs.reduce((a, c) => a + val(c), 0) % 10;
      function seq(res) { const s = [['P', 0], ['B', 0], ['P', 1], ['B', 1]]; if (res.P[2]) s.push(['P', 2]); if (res.B[2]) s.push(['B', 2]); return s; }
      function frame() {
        if (!alive) return; requestAnimationFrame(frame); if (!st) return;
        const r = st.round, n = now();
        if (r.phase === 'bet' && n < r.dealAt) {
          const left = (r.dealAt - n) / 1000; $('#btm', el).textContent = left > 0 ? `베팅 ${left.toFixed(1)}초` : '마감'; $('#bbar', el).style.width = Math.max(0, Math.min(100, left / 15 * 100)) + '%';
          if (shownRound !== r.n) { shownRound = r.n; revealed = 0; resultShown = 0; $('#pC', el).innerHTML = ''; $('#bC', el).innerHTML = ''; $('#pS', el).textContent = '-'; $('#bS', el).textContent = '-'; $$('.spot', el).forEach(s => s.classList.remove('win')); $('#sP', el).classList.remove('win'); $('#sB', el).classList.remove('win'); }
          $$('.spot', el).forEach(s => s.disabled = false);
        } else if (r.result) {
          $$('.spot', el).forEach(s => s.disabled = true);
          $('#btm', el).textContent = '딜링'; $('#bbar', el).style.width = '0%';
          if (shownRound !== r.n) { shownRound = r.n; revealed = 0; resultShown = 0; $('#pC', el).innerHTML = ''; $('#bC', el).innerHTML = ''; }
          const s = seq(r.result), due = Math.min(s.length, Math.floor((n - r.dealAt) / 850) + 1);
          while (revealed < due) {
            const [side, i] = s[revealed]; const cc = r.result[side][i];
            $(side === 'P' ? '#pC' : '#bC', el).appendChild(card(cc)); sfx('card'); revealed++;
            const shownP = s.slice(0, revealed).filter(x => x[0] === 'P').map(x => r.result.P[x[1]]), shownB = s.slice(0, revealed).filter(x => x[0] === 'B').map(x => r.result.B[x[1]]);
            $('#pS', el).textContent = shownP.length ? sc(shownP) : '-'; $('#bS', el).textContent = shownB.length ? sc(shownB) : '-';
          }
          if (revealed >= s.length && !resultShown && n > r.dealAt + s.length * 850 + 300) {
            resultShown = 1; const w = r.result.winner;
            $$('.spot', el).forEach(x => x.classList.toggle('win', x.dataset.s === w || (x.dataset.s === 'ppair' && r.result.ppair) || (x.dataset.s === 'bpair' && r.result.bpair)));
            $('#sP', el).classList.toggle('win', w === 'player'); $('#sB', el).classList.toggle('win', w === 'banker');
            const myIn = Object.values(st.mine).reduce((a, b) => a + b, 0), me = st.players.find(p => p.uid === App.me.id);
            const label = { player: 'PLAYER', banker: 'BANKER', tie: 'TIE' }[w];
            if (myIn && me && me.payout !== undefined) { const net = me.payout - myIn; S2.banner($('#bt', el), label + ' WIN', (net >= 0 ? '+' : '') + fmt(net) + 'G', net > 0 ? '#6ff0bf' : net === 0 ? '#fff' : '#ff8197'); winFx(me.payout, myIn); setTimeout(S2.refreshMe, 400); }
            else S2.banner($('#bt', el), label + ' WIN', `${r.result.p} : ${r.result.b}`, '#fff');
          }
        }
      }
      function renderSide() {
        $$('.spot', el).forEach(s => { const k = s.dataset.s; s.querySelector('.pool').textContent = st.totals[k] ? '전체 ' + fmt(st.totals[k]) : ''; s.querySelector('.mine').textContent = st.mine[k] ? '내 베팅 ' + fmt(st.mine[k]) : ''; });
        $('#brn', el).textContent = '#' + st.round.n;
        $('#brd', el).innerHTML = st.road.map(r => `<div class="bead ${r.w}${r.pp ? ' pp' : ''}${r.bp ? ' bp' : ''}">${r.w === 'player' ? 'P' : r.w === 'banker' ? 'B' : 'T'}</div>`).join(''); $('#brd', el).scrollLeft = 1e6;
        const c = { player: 0, banker: 0, tie: 0 }; st.road.forEach(r => c[r.w]++); $('#bst', el).textContent = `P ${c.player} · B ${c.banker} · T ${c.tie}`;
        $('#bpn', el).textContent = `#${st.round.n} 참가자 ${st.players.length}명`;
        $('#bpl', el).innerHTML = st.players.length ? st.players.map(p => `<div class="pl ${p.uid === App.me.id ? 'me' : ''}" data-uid="${esc(p.uid)}" style="position:relative"><div class="nm">${esc(p.nick)}</div><div class="muted" style="font-size:11px">${Object.entries(p.spots).map(([k, v]) => `${SP[k]}${k.includes('pair') ? '페어' : ''} ${fmt(v)}`).join(' · ')}</div>${p.payout !== undefined && resultShown ? `<div class="v ${p.payout > p.total ? 'green' : 'red'}">${p.payout - p.total >= 0 ? '+' : ''}${fmt(p.payout - p.total)}</div>` : ''}</div>`).join('') : '<div class="empty">이번 판 참가자가 없어요</div>';
      }
      async function poll() { const r = await GET('bac?since=' + since); syncClock(r.now); st = r; rxShow(r.reacts); if (r.reacts.length) since = Math.max(since, ...r.reacts.map(x => x.ts)); renderSide(); }
      $$('.spot', el).forEach(s => s.onclick = async () => {
        if (!st || st.round.phase !== 'bet' || now() > st.round.dealAt - 400) return toast('베팅이 마감됐어요.', true);
        const a = chip.get(); if (a > App.me.bal) return toast('게임머니가 부족해요.', true);
        s.disabled = true; try { await POST('bac/bet', { spot: s.dataset.s, amount: a }); sfx('chip'); st.mine[s.dataset.s] = (st.mine[s.dataset.s] || 0) + a; st.totals[s.dataset.s] += a; renderSide(); pl.now(); } catch (e) { err(e); } finally { s.disabled = false; }
      });
      const pl = poller(poll, () => st && st.round.phase === 'deal' ? 1500 : 1000);
      document.addEventListener('rxsent', pl.now);
      rxBind('bac', uid => $(`#bpl [data-uid="${CSS.escape(uid)}"]`, el));
      frame();
      bacV = { stop() { alive = false; pl.stop(); document.removeEventListener('rxsent', pl.now); } };
    },
    unmount() { if (bacV) bacV.stop(); bacV = null; }
  });
})();
