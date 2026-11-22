/* Boot, auth, lobby, ranking, profile */
(function () {
  'use strict';
  const { $, $$, esc, fmt, full, ago, store, App, GET, POST, toast, sfx, register, go, route, poller, rxBind, rxShow, syncClock } = S2;
  const GAME = {
    slot: { name: 'Heaven Reels', ko: '헤븐 릴', icon: 'g_slot', desc: '5릴 10라인 · 와일드 · 프리스핀 ×2 · 그랜드 잭팟', glow: 'rgba(155,123,255,.45)', g1: '#221a36', tag: 'JACKPOT', big: true },
    crash: { name: 'Rocket Live', ko: '라이브 크래시', icon: 'g_crash', desc: '모두 같은 로켓에 탑승 · 누가 끝까지 버틸까', glow: 'rgba(224,122,47,.45)', g1: '#2a1a12', tag: 'LIVE', live: true },
    bac: { name: 'Baccarat Live', ko: '라이브 바카라', icon: 'g_bac', desc: '한 테이블 한 판 · 함께 베팅', glow: 'rgba(200,32,63,.45)', g1: '#2a1018', tag: 'LIVE', live: true },
    holdem: { name: "Hold'em", ko: '텍사스 홀덤', icon: 'g_holdem', desc: '유저끼리 2~6인 대결', glow: 'rgba(47,191,143,.4)', g1: '#0f2620', tag: 'PvP', go: 'tables' },
    seotda: { name: 'Seotda', ko: '섯다', icon: 'g_seotda', desc: '광땡·땡잡이·구사까지 정통 룰', glow: 'rgba(200,32,63,.4)', g1: '#2a1010', tag: 'PvP', go: 'tables' },
    bj: { name: 'Blackjack', ko: '블랙잭', icon: 'g_bj', desc: '21을 향해 · 블랙잭 3:2', glow: 'rgba(47,191,143,.35)', g1: '#0f2420', tag: 'CARD' },
    plinko: { name: 'Starfall', ko: '스타폴', icon: 'g_plinko', desc: '별이 떨어지는 곳 · 최대 150배', glow: 'rgba(106,168,255,.4)', g1: '#121a36', tag: 'NEW' },
    mines: { name: 'Diamond Mines', ko: '다이아 마인즈', icon: 'g_mines', desc: '지뢰를 피해 보석을 캐라', glow: 'rgba(111,240,191,.35)', g1: '#10221c', tag: 'NEW' },
    hilo: { name: 'Hi-Lo Ladder', ko: '하이로우', icon: 'g_hilo', desc: '높을까 낮을까 · 계단식 배당', glow: 'rgba(214,178,106,.4)', g1: '#221c0e', tag: 'ORIGINAL' },
    dice: { name: 'Celestial Dice', ko: '다이스', icon: 'g_dice', desc: '확률을 내가 정한다 · 최대 99배', glow: 'rgba(199,182,255,.4)', g1: '#1b1530', tag: 'NEW' },
    vpoker: { name: 'Video Poker', ko: '비디오 포커', icon: 'g_vpoker', desc: '잭 이상 · 로열 플러시 800배', glow: 'rgba(214,178,106,.35)', g1: '#1e1810', tag: 'NEW' }
  };
  const GAMENAME = { ...Object.fromEntries(Object.entries(GAME).map(([k, v]) => [k, v.ko])), bonus: '보너스', admin: '관리자' };
  window.GAME = GAME; window.GAMENAME = GAMENAME;
  const gi = g => ICON[(GAME[g] || {}).icon || 'gift']();

  // ---------- boot ----------
  S2.boot = async function () {
    $('#crest').innerHTML = ICON.crest();
    $$('[data-i]').forEach(s => s.innerHTML = ICON[s.dataset.i]());
    $('#rxBtn').innerHTML = ICON.chat(); $('#rxBtn').onclick = () => S2.rxOpen();
    document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { sfx('click'); go(b.dataset.go); } });
    await refreshMe();
    if (!App.me) showAuth(); else route();
    setInterval(() => { if (App.me && !document.hidden) refreshMe(); }, 20000);
  };
  async function refreshMe() {
    try { const r = await GET('me'); App.info = r; App.reactions = r.reactions || []; if (r.me) { App.me = r.me; S2.setBal(r.me.bal, false); } else App.me = null; } catch (e) { if (!App.info) toast('서버에 연결할 수 없어요.', true); }
  }
  S2.refreshMe = refreshMe;

  // ---------- auth ----------
  function showAuth() {
    $$('.view').forEach(v => v.classList.remove('on'));
    $('#nav').classList.add('hide'); $('#wallet').classList.add('hide'); $('#top').classList.add('hide');
    const el = $('#v-auth'); el.classList.add('on');
    let mode = 'login';
    const render = () => {
      el.innerHTML = `<div class="auth"><div>${ICON.emblem()}</div><div class="ey">SEASON II · CELESTIA</div><h1 class="foil">JUNJA LAND</h1>
        <p>하늘이 내려준 카지노에 오신 것을 환영합니다.<br>${mode === 'login' ? '닉네임으로 입장하세요.' : '가입하면 시즌 2 오픈 기념 <b class="gold">1억G</b>를 드려요.'}</p>
        <form class="panel deco" id="af"><label>닉네임</label><input class="inp" name="nick" maxlength="12" autocomplete="username" placeholder="2~12자" required>
        <label>비밀번호</label><input class="inp" name="pw" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="4자 이상" required>
        ${mode === 'reg' ? '<label>비밀번호 확인</label><input class="inp" name="pw2" type="password" autocomplete="new-password" required>' : ''}
        <button class="btn gold wide xl" style="margin-top:18px">${mode === 'login' ? '입장하기' : '가입하고 1억G 받기'}</button></form>
        <div class="sw">${mode === 'login' ? '처음이세요? <button id="sw">회원가입</button>' : '이미 계정이 있나요? <button id="sw">로그인</button>'}</div>
        <div class="foot">게임머니는 현금 가치가 없는 오락용 가상 재화입니다.<br>비밀번호를 잊으면 관리자에게 초기화를 요청하세요.</div></div>`;
      $('#sw').onclick = () => { mode = mode === 'login' ? 'reg' : 'login'; render(); };
      $('#af').onsubmit = async e => {
        e.preventDefault(); const f = new FormData(e.target);
        if (mode === 'reg' && f.get('pw') !== f.get('pw2')) return toast('비밀번호가 서로 달라요.', true);
        try {
          const r = await POST(mode === 'login' ? 'login' : 'register', { nick: f.get('nick'), pw: f.get('pw') });
          App.token = r.token; store.set('tok', r.token);
          await refreshMe();
          $('#nav').classList.remove('hide'); $('#wallet').classList.remove('hide'); $('#top').classList.remove('hide');
          if (mode === 'reg') { toast('시즌 2 오픈 기념 1억G가 지급되었어요 ✦', false, 3000); S2.sfx('win'); }
          location.hash = 'lobby'; route();
        } catch (er) { toast(er.message, true); }
      };
    };
    render();
  }
  window.showAuth = showAuth;
  async function logout() { try { await POST('logout'); } catch {} App.token = ''; store.set('tok', ''); App.me = null; showAuth(); }

  // ---------- lobby ----------
  let lobbyPoll = null, cat = store.get('cat', 'all');
  register('lobby', {
    mount(el) {
      const I = App.info || {}, me = App.me;
      const order = ['slot', 'crash', 'bac', 'holdem', 'seotda', 'bj', 'plinko', 'mines', 'hilo', 'dice', 'vpoker'];
      const cats = { all: '전체', live: '라이브·대전', solo: '싱글', card: '카드' };
      const inCat = g => cat === 'all' || (cat === 'live' && ['crash', 'bac', 'holdem', 'seotda'].includes(g)) || (cat === 'solo' && ['slot', 'plinko', 'mines', 'hilo', 'dice'].includes(g)) || (cat === 'card' && ['bj', 'bac', 'holdem', 'seotda', 'vpoker', 'hilo'].includes(g));
      el.innerHTML = `
        <div class="hero"><div class="ring"></div><div class="ey">SEASON II · CELESTIA</div>
          <h1>하늘이 <span class="foil">내려준</span><br>카지노</h1>
          <p>${esc(me.nick)}님, 오늘의 운은 어떤가요?<br>열한 개의 테이블이 당신을 기다립니다.</p>
          <div class="jp"><div><div class="l">HALO GRAND JACKPOT</div><div class="a foil" id="jpA">${full(I.jackpot)} G</div></div>${ICON.g_slot()}</div>
          <div class="stats3"><div><b id="onl">${I.online || 1}</b><span>접속 중</span></div><div><b>${esc(me.rankName)}</b><span>나의 등급</span></div><div><b class="gold">${fmt(me.bal)}</b><span>보유 G</span></div></div>
        </div>
        ${I.notice ? `<div class="notice"><b class="gold">공지</b><span>${esc(I.notice)}</span></div>` : ''}
        ${(I.ticker || []).length ? `<div class="ticker"><div class="tr">${I.ticker.map(t => `<span>✦ <b>${esc(t.nick)}</b>님 ${esc(GAMENAME[t.game] || t.game)}에서 <b>×${t.x.toFixed(1)}</b> · ${fmt(t.payout)}G</span>`).join('')}</div></div>` : ''}
        <div class="perks">
          <button class="perk ${me.dailyReady ? 'ready' : ''}" id="pd">${ICON.gift()}<div><b>출석 보너스</b><span>${me.dailyReady ? '+' + fmt(me.dailyAmt) + 'G 받기' : '내일 다시 받을 수 있어요'}</span></div></button>
          <button class="perk ${me.bal < 10000 && Date.now() > me.rescueReadyAt ? 'ready' : ''}" id="pr">${ICON.wing()}<div><b>천사의 구제금</b><span>${me.bal < 10000 ? (Date.now() > me.rescueReadyAt ? '+500만G 받기' : '잠시 후 가능') : '1만G 미만일 때'}</span></div></button>
        </div>
        <div class="sec"><h2>Tables</h2><small>11 GAMES</small><div class="rule"></div></div>
        <div class="tabs" id="cats">${Object.entries(cats).map(([k, v]) => `<button data-c="${k}" class="${k === cat ? 'on' : ''}">${v}</button>`).join('')}</div>
        <div class="games">${order.filter(inCat).map((g, i) => { const m = GAME[g], off = (I.disabled || {})[g]; return `<button class="game ${(cat === 'all' && m.big) || (cat !== 'all' && i === 0) ? 'big' : ''}" style="--glow:${m.glow};--g1:${m.g1}" data-go="${m.go || g}">
            <span class="tag ${m.live || m.tag === 'PvP' ? 'live' : ''}">${m.tag}</span><span class="art">${ICON[m.icon]()}</span><h3>${m.name}</h3><p>${m.ko} · ${m.desc}</p>${m.live || m.go ? `<div class="who" data-w="${g}"></div>` : ''}${off ? '<div class="off">점검 중</div>' : ''}</button>`; }).join('')}</div>
        <div class="foot">JUNJA LAND CASINO · SEASON II · CELESTIA<br>게임머니는 현금 가치가 없는 오락용 가상 재화입니다</div>`;
      $('#cats').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; cat = b.dataset.c; store.set('cat', cat); sfx('click'); this.unmount(); this.mount(el); };
      $('#pd').onclick = async () => { try { const r = await POST('daily'); toast(`출석 보너스 +${fmt(r.amount)}G`); sfx('win'); await refreshMe(); this.unmount(); this.mount(el); } catch (e) { toast(e.message, true); } };
      $('#pr').onclick = async () => { try { const r = await POST('rescue'); toast(`천사의 구제금 +${fmt(r.amount)}G`); sfx('win'); await refreshMe(); this.unmount(); this.mount(el); } catch (e) { toast(e.message, true); } };
      rxBind('lobby', null);
      let since = 0;
      lobbyPoll = poller(async () => {
        const r = await GET('lobby?since=' + since);
        rxShow(r.reacts); if (r.reacts && r.reacts.length) since = Math.max(since, ...r.reacts.map(x => x.ts));
        const by = { holdem: 0, seotda: 0 }; r.tables.forEach(t => by[t.game] += t.players);
        $$('[data-w]', el).forEach(w => { const g = w.dataset.w; if (by[g] !== undefined) w.textContent = by[g] ? `${by[g]}명 플레이 중` : ''; });
      }, 5000);
      document.addEventListener('rxsent', lobbyPoll.now);
    },
    unmount() { if (lobbyPoll) { lobbyPoll.stop(); document.removeEventListener('rxsent', lobbyPoll.now); } lobbyPoll = null; }
  });

  // ---------- ranking ----------
  register('rank', {
    async mount(el) {
      el.innerHTML = `<div class="title"><div><h1 class="foil">Hall of Fame</h1><div class="sub">RANKING · 명예의 전당</div></div></div><div class="tabs" id="rt"><button data-t="rich" class="on">자산 순위</button><button data-t="hof">대박 순간</button><button data-t="mine">내 기록</button></div><div id="rl"><div class="empty">불러오는 중…</div></div>`;
      const box = $('#rl', el);
      const show = async t => {
        $$('#rt button', el).forEach(b => b.classList.toggle('on', b.dataset.t === t));
        try {
          if (t === 'mine') {
            const r = await GET('history');
            box.innerHTML = r.history.length ? `<div class="list">${r.history.map(h => { const n = h.payout - h.wager; return `<div class="li"><div class="gi">${gi(h.game)}</div><div class="m">${esc(GAMENAME[h.game] || h.game)}<small>${esc(h.note)} · ${ago(h.ts)}</small></div><div class="v ${n > 0 ? 'green' : n < 0 ? 'red' : ''}">${n > 0 ? '+' : ''}${fmt(n)}</div></div>`; }).join('')}</div>` : '<div class="empty">아직 기록이 없어요</div>';
            return;
          }
          const r = await GET('rank');
          if (t === 'rich') box.innerHTML = `<div class="list">${r.rich.map((u, i) => `<div class="li"><div class="rk">${i + 1}</div><div style="width:36px;height:36px">${ICON.avatar(u.avatar, u.nick)}</div><div class="m"><b>${esc(u.nick)}</b><small>${esc(['별빛 루키', '문라이트 플레이어', '골드 하이롤러', '플래티넘 VIP', '셀레스티아 로열', '하늘이 내려준 자'][u.rank])}</small></div><div class="v gold">${fmt(u.bal)}</div></div>`).join('')}</div>`;
          else box.innerHTML = r.hof.length ? `<div class="list">${r.hof.map((h, i) => `<div class="li"><div class="rk">${i + 1}</div><div class="gi">${gi(h.game)}</div><div class="m"><b>${esc(h.nick)}</b> · ${esc(GAMENAME[h.game] || h.game)}<small>${esc(h.note)} · ${ago(h.ts)}</small></div><div class="v gold">+${fmt(h.payout)}<small class="muted" style="display:block;font-size:10.5px">×${(h.payout / h.wager).toFixed(1)}</small></div></div>`).join('')}</div>` : '<div class="empty">아직 50배 이상 대박이 없어요.<br>첫 번째 주인공이 되어 보세요.</div>';
        } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
      };
      $('#rt', el).onclick = e => { const b = e.target.closest('[data-t]'); if (b) show(b.dataset.t); };
      show('rich');
    }
  });

  // ---------- me ----------
  register('me', {
    async mount(el) {
      await refreshMe(); const me = App.me;
      const pct = me.nextRank ? Math.min(100, (me.peak - me.nextRank.from) / (me.nextRank.at - me.nextRank.from) * 100) : 100;
      el.innerHTML = `<div class="panel rankcard deco"><div class="av">${ICON.avatar(me.avatar, me.nick)}</div><div style="flex:1;min-width:0"><div class="muted" style="font-size:10px;letter-spacing:.3em">MY RANK</div><div style="font-family:var(--kserif);font-size:20px;font-weight:700;margin-top:3px">${esc(me.nick)}</div><div class="gold" style="font-size:13px;margin-top:2px">${esc(me.rankName)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="muted" style="font-size:11px;margin-top:6px">${me.nextRank ? `${esc(me.nextRank.name)}까지 최고 잔액 ${fmt(me.nextRank.at - me.peak)}G` : '최고 등급 · 하늘이 내려준 자'}</div></div></div>
        <div class="sec"><h2>Medallion</h2><small>아바타</small><div class="rule"></div></div>
        <div class="avpick" id="avp">${AVC.map((_, i) => `<button data-a="${i}" class="${i === me.avatar ? 'on' : ''}">${ICON.avatar(i, me.nick)}</button>`).join('')}</div>
        <div class="sec"><h2>Statistics</h2><small>게임별 통계</small><div class="rule"></div></div><div id="gs" class="list"><div class="empty">불러오는 중…</div></div>
        <div class="sec"><h2>Settings</h2><small>설정</small><div class="rule"></div></div>
        <div class="panel"><label class="tog"><input type="checkbox" id="snd" ${store.get('sound', true) ? 'checked' : ''}><i></i>효과음</label>
        ${me.admin ? '<a class="btn line wide" href="/admin" style="margin-top:14px;text-decoration:none">관리자 페이지 열기</a>' : ''}
        <button class="btn dark wide" id="lo" style="margin-top:10px">로그아웃</button></div>
        <div class="foot">관리자이신가요? <a href="/admin">관리자 페이지</a></div>`;
      $('#snd', el).onchange = e => store.set('sound', e.target.checked);
      $('#lo', el).onclick = logout;
      $('#avp', el).onclick = async e => { const b = e.target.closest('[data-a]'); if (!b) return; try { await POST('avatar', { avatar: +b.dataset.a }); App.me.avatar = +b.dataset.a; $$('#avp button', el).forEach(x => x.classList.toggle('on', x === b)); $('.rankcard .av', el).innerHTML = ICON.avatar(+b.dataset.a, me.nick); } catch (er) { toast(er.message, true); } };
      try {
        const r = await GET('history'); const st = Object.fromEntries(r.stats.map(s => [s.game, s]));
        const tot = r.stats.filter(s => GAME[s.game]).reduce((a, s) => ({ w: a.w + s.wager, p: a.p + s.payout, n: a.n + s.plays }), { w: 0, p: 0, n: 0 });
        $('#gs', el).outerHTML = `<div class="kv" style="margin-bottom:8px"><div><small>총 플레이</small><b>${full(tot.n)}판</b></div><div><small>순손익</small><b class="${tot.p - tot.w >= 0 ? 'green' : 'red'}">${tot.p - tot.w >= 0 ? '+' : ''}${fmt(tot.p - tot.w)}</b></div><div><small>총 베팅</small><b>${fmt(tot.w)}</b></div><div><small>최고 잔액</small><b class="gold">${fmt(me.peak)}</b></div></div>
          <div class="list">${Object.keys(GAME).map(g => { const s = st[g] || { plays: 0, wager: 0, payout: 0, wins: 0, best: 0 }; const n = s.payout - s.wager; return `<div class="li"><div class="gi">${gi(g)}</div><div class="m">${GAME[g].ko}<small>${s.plays}판 · 승률 ${s.plays ? Math.round(s.wins / s.plays * 100) : 0}% · 최고 +${fmt(s.best)}</small></div><div class="v ${n > 0 ? 'green' : n < 0 ? 'red' : ''}">${n > 0 ? '+' : ''}${fmt(n)}</div></div>`; }).join('')}</div>`;
      } catch (e) {}
    }
  });

  // shared page header for game views
  S2.head = (g, extra = '') => `<button class="back" data-go="${GAME[g] && GAME[g].go ? GAME[g].go : 'lobby'}">${ICON.back()} 로비</button><div class="title"><div><h1 class="foil">${GAME[g] ? GAME[g].name : g}</h1><div class="sub">${GAME[g] ? GAME[g].ko.toUpperCase() : ''}</div></div>${extra}</div>`;
  S2.syncFromServer = syncClock;
})();
