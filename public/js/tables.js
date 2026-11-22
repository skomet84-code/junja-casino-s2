/* Player-vs-player tables: Texas Hold'em, Seotda */
(function () {
  'use strict';
  const { $, $$, esc, fmt, full, App, GET, POST, toast, sfx, register, card, hwatu, poller, syncClock, now, rxBind, rxShow, modal, confirmBox } = S2;
  const err = e => toast(e.message, true);

  register('tables', {
    async mount(el) {
      el.innerHTML = `<div class="title"><div><h1 class="foil">Card Room</h1><div class="sub">유저끼리 대결 · 텍사스 홀덤 · 섯다</div></div><span class="live"><i></i>PvP</span></div>
        <div class="tabs" id="tt"><button data-g="holdem" class="on">텍사스 홀덤</button><button data-g="seotda">섯다</button></div><div class="tlist" id="tl"><div class="empty">불러오는 중…</div></div>
        <div class="panel" style="margin-top:14px;font-size:12.5px;line-height:1.7;color:#cfc6dc"><b class="gold">테이블 이용 안내</b><br>바이인(테이블에 들고 가는 금액)을 정해 앉으면 지갑에서 빠져나가고, 일어나면 남은 칩이 지갑으로 돌아옵니다. 차례마다 20초가 주어지며 두 번 연속 시간을 넘기면 자동으로 자리에서 일어나요. 하우스 수수료는 없습니다.</div>`;
      let g = S2.store.get('tg', 'holdem');
      const show = async () => {
        $$('#tt button', el).forEach(b => b.classList.toggle('on', b.dataset.g === g));
        try {
          const r = await GET('lobby');
          $('#tl', el).innerHTML = r.tables.filter(t => t.game === g).map(t => `<button class="tl" data-go="table-${t.id}"><div class="ic">${ICON[g === 'holdem' ? 'g_holdem' : 'g_seotda']()}</div><div class="m"><b>${esc(t.name)}</b>${t.minTier ? `<span class="vipt">VIP</span>` : ''}<small>${g === 'holdem' ? `블라인드 ${fmt(t.sb)} / ${fmt(t.bb)}` : `앤티 ${fmt(t.ante)}`} · 바이인 ${fmt(t.min)} ~ ${fmt(t.max)}</small>${t.minTier && App.me.rank < t.minTier ? `<small class="gold">${esc(App.info.tiers[t.minTier].name)} 이상 착석 가능 · 관전은 누구나</small>` : ''}<div class="seatdots">${Array.from({ length: t.seats }, (_, i) => `<i class="${i < t.players ? 'on' : ''}"></i>`).join('')}</div>${t.nicks.length ? `<small class="gold">${t.nicks.map(esc).join(', ')}</small>` : ''}</div><div class="v gold" style="font-weight:800">${t.players}/${t.seats}</div></button>`).join('');
        } catch (e) { $('#tl', el).innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
      };
      $('#tt', el).onclick = e => { const b = e.target.closest('[data-g]'); if (!b) return; g = b.dataset.g; S2.store.set('tg', g); show(); };
      show();
    }
  });

  // display positions for 6 seats (index 0 = bottom = me)
  const POS = [[50, 372], [11, 300], [13, 140], [50, 60], [87, 140], [89, 300]];
  let tV = null;
  register('table', {
    mount(el, id) {
      let st = null, alive = true, since = 0, lastTurnHand = '', lastShowHand = 0, raiseTo = 0;
      el.innerHTML = `<button class="back" data-go="tables">${ICON.back()} 카드룸</button>
        <div class="title"><div><h1 class="foil" id="tn">Table</h1><div class="sub" id="ts"></div></div><button class="btn line sm hide" id="tleave" style="margin-left:auto">자리 떠나기</button></div>
        <div class="ptable" id="pt"><div class="oval" id="ov"><div class="ctr"><div class="brd" id="brd"></div><div class="pot" id="pot"></div><div class="lg" id="lg">Maison Celestia</div></div></div><div id="seats"></div><div class="myhand" id="mh"></div></div>
        <div id="acts"></div><div class="tlog" id="tlog"></div>`;
      const seatsEl = $('#seats', el);
      const order = () => { const base = st && st.mySeat >= 0 ? st.mySeat : 0; return Array.from({ length: 6 }, (_, k) => (base + k) % 6); };
      const isH = () => st && st.game === 'holdem';
      const cardOf = c => isH() ? card(c) : hwatu(c);
      function render() {
        const ord = order(), me = st.mySeat, winners = st.last && st.last.winners ? st.last.winners.map(w => w.seat) : [];
        $('#tn', el).textContent = st.name; $('#ts', el).textContent = (isH() ? `텍사스 홀덤 · 블라인드 ${fmt(st.cfg.sb)}/${fmt(st.cfg.bb)}` : `섯다 · 앤티 ${fmt(st.cfg.ante)}`) + (st.handNo ? ` · #${st.handNo}` : '');
        $('#ov', el).classList.toggle('sd', !isH());
        $('#tleave', el).classList.toggle('hide', me < 0);
        // board
        const brd = $('#brd', el); const want = isH() ? st.board : [];
        if (brd.childElementCount !== want.length || st.phase === 'wait') { brd.innerHTML = ''; want.forEach((c, i) => { const e = card(c); e.style.animationDelay = (i * 80) + 'ms'; brd.appendChild(e); }); }
        if (isH() && st.phase === 'show' && st.last && st.last.reveal) { const best = new Set(); st.last.winners.forEach(w => { const rv = st.last.reveal.find(x => x.seat === w.seat); if (rv && rv.best) rv.best.forEach(c => best.add(c.r + c.s)); }); $$('.pc', brd).forEach((e, i) => e.classList.toggle('hl', best.has(st.board[i].r + st.board[i].s))); }
        $('#lg', el).style.display = st.pot ? 'none' : '';
        $('#pot', el).innerHTML = st.pot ? `POT <b>${fmt(st.pot)}</b>` : st.phase === 'wait' ? `<span class="muted">${st.seats.filter(Boolean).length < 2 ? '두 명 이상 앉으면 시작해요' : '곧 시작합니다…'}</span>` : '';
        // seats
        seatsEl.innerHTML = '';
        ord.forEach((si, k) => {
          const s = st.seats[si], [x, y] = POS[k];
          const d = document.createElement('div'); d.className = 'seat'; d.style.left = x + '%'; d.style.top = y + 'px'; d.dataset.seat = si;
          if (!s) {
            d.innerHTML = me < 0 ? `<button class="empty" data-sit="${si}">앉기</button>` : `<div class="empty" style="opacity:.35">빈자리</div>`;
            seatsEl.appendChild(d); return;
          }
          d.dataset.uid = s.uid;
          const turn = st.phase === 'play' && st.toAct === si, win = st.phase === 'show' && winners.includes(si);
          d.classList.toggle('fold', s.folded || (!s.inHand && st.phase !== 'wait')); d.classList.toggle('turn', turn); d.classList.toggle('win', win);
          const showCards = si !== me && s.cards.length;
          d.innerHTML = `<div class="av">${S2.framed(s.tier, s.avatar, s.nick)}${turn ? '<svg class="ring" viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="3"/><circle class="tr" cx="30" cy="30" r="28" fill="none" stroke="#f3e3b3" stroke-width="3" stroke-dasharray="176" stroke-dashoffset="0" stroke-linecap="round"/></svg>' : ''}${st.dealer === si && isH() ? '<span class="dbtn">D</span>' : ''}</div>
            <div class="nm ${S2.nickCls(s.tier)}">${esc(s.nick)}${si === me ? ' (나)' : ''}</div><div class="stk">${fmt(s.stack)}</div>
            <div class="st">${win ? `<span class="hn">+${fmt(s.won)}</span>` : s.leave ? '퇴장 예정' : s.allin ? '<span class="red">ALL-IN</span>' : s.folded ? (isH() ? '폴드' : '다이') : esc(s.lastAct || '')}</div>
            ${showCards ? '<div class="hc"></div>' : ''}${s.handName && si !== me ? `<div class="hn">${esc(s.handName)}</div>` : ''}`;
          if (showCards) { const hc = d.querySelector('.hc'); s.cards.forEach(c => { const e = cardOf(c); e.style.animation = 'none'; hc.appendChild(e); }); }
          seatsEl.appendChild(d);
          if (s.bet > 0) { const b = document.createElement('div'); b.className = 'seat'; b.style.left = (x + (50 - x) * .42) + '%'; b.style.top = (y + (215 - y) * .42 + (k === 0 ? -30 : 0)) + 'px'; b.innerHTML = `<span class="betchip" style="position:static;display:inline-block">${fmt(s.bet)}</span>`; seatsEl.appendChild(b); }
        });
        // my hand
        const mh = $('#mh', el); mh.innerHTML = '';
        if (me >= 0 && st.seats[me] && st.seats[me].cards.length) {
          const s = st.seats[me]; const cs = document.createElement('div'); cs.className = 'cards';
          s.cards.forEach(c => { const e = isH() ? card(c) : hwatu(c, 'big'); e.style.animation = mh.dataset.h === String(st.handNo) ? 'none' : ''; cs.appendChild(e); });
          mh.appendChild(cs); mh.dataset.h = st.handNo;
          const rk = s.myRank || s.myHand || s.handName; if (rk) { const r = document.createElement('div'); r.className = 'rk'; r.textContent = rk; mh.appendChild(r); }
        }
        // actions
        renderActs();
        $('#tlog', el).innerHTML = st.log.slice(-4).map(esc).join('<br>');
        // showdown banner
        if (st.phase === 'show' && st.last && lastShowHand !== st.handNo) {
          lastShowHand = st.handNo;
          if (st.last.replay) S2.banner($('#pt', el), '재경기', `${st.last.by} · ${st.last.name}`, '#f3e3b3');
          else if (st.last.winners) { const w = st.last.winners; S2.banner($('#pt', el), w.length > 1 ? 'SPLIT POT' : w[0].nick, w.map(x => `${x.hand ? x.hand + ' · ' : ''}+${fmt(x.amount)}`).join(' / '), '#6ff0bf'); if (w.some(x => x.seat === me)) { sfx('win'); setTimeout(S2.refreshMe, 300); } }
        }
      }
      function renderActs() {
        const box = $('#acts', el), m = st.me;
        const key = m ? `${st.handNo}:${st.street}:${m.curBet}:${m.toCall}` : '';
        if (!m) { box.innerHTML = st.mySeat >= 0 && st.phase === 'play' ? `<div class="turnbar"><i id="tb" style="width:0"></div></div><div class="muted" style="text-align:center;font-size:12.5px;margin-top:8px">${st.seats[st.toAct] ? esc(st.seats[st.toAct].nick) + '님 차례' : ''}</div>` : ''; box.dataset.k = ''; return; }
        if (box.dataset.k === key) return; box.dataset.k = key;
        if (lastTurnHand !== key) { lastTurnHand = key; sfx('pop'); if (navigator.vibrate) try { navigator.vibrate(60); } catch {} }
        const call = m.toCall > 0 ? `콜 ${fmt(m.toCall)}` : '체크';
        if (isH()) {
          raiseTo = Math.min(m.maxRaiseTo, Math.max(m.minRaiseTo, raiseTo || m.minRaiseTo));
          const canRaise = m.maxRaiseTo > m.curBet;
          box.innerHTML = `<div class="turnbar"><i id="tb"></i></div><div class="acts" style="grid-template-columns:1fr 1.3fr 1fr"><button class="btn ruby" data-a="fold">폴드</button><button class="btn emerald" data-a="${m.toCall > 0 ? 'call' : 'check'}">${call}</button><button class="btn violet" data-a="allin">올인</button></div>
            ${canRaise && m.maxRaiseTo > m.minRaiseTo ? `<div class="raisebox"><div class="row" style="margin-bottom:8px"><button class="btn dark sm" data-q="min">최소</button><button class="btn dark sm" data-q="half">½ 팟</button><button class="btn dark sm" data-q="pot">팟</button></div><input type="range" id="rr" min="${m.minRaiseTo}" max="${m.maxRaiseTo}" step="${st.cfg.sb}" value="${raiseTo}"><button class="btn gold wide" id="rgo" style="margin-top:8px">레이즈 → ${fmt(raiseTo)}</button></div>` : ''}`;
          const rr = $('#rr', box), set = v => { raiseTo = Math.max(m.minRaiseTo, Math.min(m.maxRaiseTo, Math.round(v / st.cfg.sb) * st.cfg.sb)); if (rr) rr.value = raiseTo; const b = $('#rgo', box); if (b) b.textContent = `레이즈 → ${fmt(raiseTo)}`; };
          if (rr) rr.oninput = e => set(+e.target.value);
          $$('[data-q]', box).forEach(b => b.onclick = () => { const pot = m.pot + m.toCall; set(b.dataset.q === 'min' ? m.minRaiseTo : b.dataset.q === 'half' ? m.curBet + Math.floor(pot / 2) : m.curBet + pot); });
          const rg = $('#rgo', box); if (rg) rg.onclick = () => doAct({ type: 'raise', amount: raiseTo });
        } else {
          box.innerHTML = `<div class="turnbar"><i id="tb"></i></div><div class="acts" style="grid-template-columns:repeat(3,1fr)"><button class="btn ruby" data-a="fold">다이</button><button class="btn emerald" data-a="${m.toCall > 0 ? 'call' : 'check'}">${call}</button><button class="btn line" data-a="bbing">삥</button><button class="btn violet" data-a="half">하프</button><button class="btn violet" data-a="ddadang">따당</button><button class="btn gold" data-a="allin">올인</button></div>`;
        }
        $$('[data-a]', box).forEach(b => b.onclick = () => doAct({ type: b.dataset.a }));
      }
      async function doAct(a) {
        $$('#acts button', el).forEach(b => b.disabled = true);
        try { st = { ...(await POST(`table/${id}/act`, a)), reacts: [] }; sfx('chip'); render(); } catch (e) { err(e); $('#acts', el).dataset.k = ''; renderActs(); }
      }
      seatsEl.onclick = e => {
        const b = e.target.closest('[data-sit]'); if (!b) return;
        const si = +b.dataset.sit, c = st.cfg, max = Math.min(c.max, App.me.bal);
        if (c.minTier && App.me.rank < c.minTier) return toast(`${App.info.tiers[c.minTier].name} 이상만 앉을 수 있는 VIP 테이블이에요.`, true);
        if (max < c.min) return toast(`바이인 최소 ${fmt(c.min)}G가 필요해요.`, true);
        let v = Math.min(max, Math.max(c.min, c.min * 2.5));
        modal(`<h4>${esc(st.name)} · ${si + 1}번 자리</h4><p>테이블에 들고 갈 금액을 정하세요. 일어나면 남은 칩은 지갑으로 돌아옵니다.</p><div class="bigx foil" id="bv"></div><input type="range" id="bi" min="${c.min}" max="${max}" step="${c.min / 20}" value="${v}" style="width:100%;accent-color:#d6b26a"><div class="row muted" style="font-size:11px;margin:4px 0 16px"><span>${fmt(c.min)}</span><span style="text-align:right">${fmt(max)}</span></div><div class="row"><button class="btn dark" data-x>취소</button><button class="btn gold" id="bgo">앉기</button></div>`, (m, close) => {
          const upd = () => { m.querySelector('#bv').textContent = fmt(v) + ' G'; };
          m.querySelector('#bi').oninput = e => { v = +e.target.value; upd(); }; upd();
          m.querySelector('[data-x]').onclick = close;
          m.querySelector('#bgo').onclick = async () => { try { st = { ...(await POST(`table/${id}/sit`, { seat: si, buyin: v })) }; close(); sfx('chip'); render(); } catch (er) { err(er); } };
        });
      };
      $('#tleave', el).onclick = async () => {
        const s = st.seats[st.mySeat]; const mid = st.phase === 'play' && s && s.inHand && !s.folded;
        if (!(await confirmBox('자리 떠나기', mid ? '진행 중인 판은 포기(폴드)하고, 판이 끝나면 남은 칩이 지갑으로 돌아가요.' : `남은 칩 ${fmt(s ? s.stack : 0)}G가 지갑으로 돌아가요.`, '떠나기'))) return;
        try { st = await POST(`table/${id}/leave`); render(); S2.refreshMe(); } catch (e) { err(e); }
      };
      async function poll() {
        const r = await GET(`table/${id}?since=${since}`); syncClock(r.now); const prevMine = st && st.mySeat;
        st = r; rxShow(r.reacts); if (r.reacts.length) since = Math.max(since, ...r.reacts.map(x => x.ts)); render();
        if (prevMine >= 0 && r.mySeat < 0) { toast('자리에서 일어났어요. 남은 칩은 지갑으로 돌아갔어요.'); S2.refreshMe(); }
      }
      (function tickLoop() {
        if (!alive) return; requestAnimationFrame(tickLoop); if (!st || st.phase !== 'play') return;
        const left = Math.max(0, st.deadline - now()), p = left / st.actMs;
        const ring = $('.seat.turn .tr', el); if (ring) ring.style.strokeDashoffset = String(176 * (1 - p));
        const tb = $('#tb', el); if (tb) { tb.style.width = (p * 100) + '%'; }
      })();
      const pl = poller(poll, () => !st ? 1200 : st.phase === 'play' ? 1200 : 1800);
      document.addEventListener('rxsent', pl.now);
      rxBind('t:' + id, uid => $(`.seat[data-uid="${CSS.escape(uid)}"]`, el));
      tV = { stop() { alive = false; pl.stop(); document.removeEventListener('rxsent', pl.now); } };
    },
    unmount() { if (tV) tV.stop(); tV = null; }
  });
})();
