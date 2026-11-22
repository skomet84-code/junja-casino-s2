/* Admin console */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => { n = Math.floor(Number(n) || 0); const g = n < 0; n = Math.abs(n); const t = v => (Math.floor(v * 100) / 100).toLocaleString('ko-KR'); const s = n >= 1e12 ? t(n / 1e12) + '조' : n >= 1e8 ? t(n / 1e8) + '억' : n >= 1e4 ? t(n / 1e4) + '만' : n.toLocaleString('ko-KR'); return (g ? '-' : '') + s; };
  const full = n => Math.floor(Number(n) || 0).toLocaleString('ko-KR');
  const dt = t => t ? new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
  let tok = ''; try { tok = JSON.parse(localStorage.getItem('s2.tok') || '""'); } catch {}
  const G = { slot: '헤븐 릴', crash: '라이브 크래시', bac: '라이브 바카라', holdem: '텍사스 홀덤', seotda: '섯다', bj: '블랙잭', plinko: '스타폴', mines: '다이아 마인즈', hilo: '하이로우', dice: '다이스', vpoker: '비디오 포커', draw: '셀레스티얼 77', bonus: '보너스', admin: '관리자' };
  async function api(path, body, method = 'POST') {
    const r = await fetch('/api/' + path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(tok ? { 'x-token': tok } : {}) }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || '오류'); e.status = r.status; throw e; } return j;
  }
  function toast(m, e) { $$('.toast').forEach(t => t.remove()); const t = document.createElement('div'); t.className = 'toast' + (e ? ' err' : ''); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }
  function ask(title, html, ok = '확인', danger) {
    return new Promise(res => { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="in"><h4>${esc(title)}</h4><div style="margin:8px 0 16px;color:var(--muted);font-size:13.5px">${html}</div><div class="row"><button class="btn dark" data-a="0">취소</button><button class="btn ${danger ? 'ruby' : 'gold'}" data-a="1">${esc(ok)}</button></div></div>`; document.body.appendChild(m);
      m.onclick = e => { const b = e.target.closest('[data-a]'); if (b || e.target === m) { const vals = Object.fromEntries($$('input,select,textarea', m).map(i => [i.name, i.type === 'checkbox' ? i.checked : i.value])); m.remove(); res(b && b.dataset.a === '1' ? vals : null); } }; });
  }
  $('#crest').innerHTML = ICON.crest();
  const root = $('#root');

  function loginForm(msg) {
    root.innerHTML = `<form class="panel deco" id="lf" style="max-width:420px;margin:40px auto"><h3 class="kserif" style="margin-top:0">관리자 로그인</h3><p class="muted" style="font-size:13.5px;line-height:1.6">${msg || '카지노 계정(관리자로 연결된 닉네임)으로 로그인하세요.'}</p>
      <input class="inp" name="nick" placeholder="닉네임" autocomplete="username" required><input class="inp" name="pw" type="password" placeholder="비밀번호" autocomplete="current-password" required style="margin-top:8px">
      <button class="btn gold wide" style="margin-top:12px">로그인</button></form>`;
    $('#lf').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      try { const r = await api('login', { nick: f.get('nick'), pw: f.get('pw') }); tok = r.token; try { localStorage.setItem('s2.tok', JSON.stringify(tok)); } catch {} boot(); }
      catch (er) { toast(er.message, true); }
    };
  }
  async function boot() {
    try { await api('admin/dashboard'); tabs('dash'); }
    catch (e) {
      if (e.status === 401) return loginForm();
      if (e.status === 403) {
        root.innerHTML = `<div class="panel deco" style="max-width:440px;margin:40px auto"><h3 class="kserif" style="margin-top:0">관리자 인증</h3><p class="muted" style="font-size:13.5px;line-height:1.6">지금 로그인한 계정에 관리자 권한을 연결합니다. 받은 <b class="gold">관리자 코드</b>를 입력하세요. 한 번만 하면 돼요.</p><input class="inp" id="code" type="password" placeholder="관리자 코드"><button class="btn gold wide" id="claim" style="margin-top:12px">권한 연결</button><button class="btn dark wide" id="other" style="margin-top:8px">다른 계정으로 로그인</button></div>`;
        $('#claim').onclick = async () => { try { await api('admin/claim', { code: $('#code').value.trim() }); toast('관리자 권한이 연결됐어요'); boot(); } catch (er) { toast(er.message, true); } };
        $('#other').onclick = () => loginForm();
      } else root.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }
  function tabs(cur) {
    root.innerHTML = `<div class="tabs" id="at">${[['dash', '대시보드'], ['users', '회원 관리'], ['games', '게임 설정'], ['tables', '테이블'], ['log', '관리 기록']].map(([k, v]) => `<button data-t="${k}" class="${k === cur ? 'on' : ''}">${v}</button>`).join('')}</div><div id="ac"></div>`;
    $('#at').onclick = e => { const b = e.target.closest('[data-t]'); if (b) tabs(b.dataset.t); };
    ({ dash, users, games, tables, log })[cur]($('#ac'));
  }

  async function dash(el) {
    const d = await api('admin/dashboard');
    const sum = rows => rows.reduce((a, r) => ({ w: a.w + r.wager, p: a.p + r.payout, n: a.n + r.plays }), { w: 0, p: 0, n: 0 });
    const real = r => r.filter(x => !['bonus', 'admin', 'draw'].includes(x.game));
    const t = sum(real(d.today)), w = sum(real(d.week));
    const tbl = rows => `<div class="tw"><table class="t"><tr><th>게임</th><th>판수</th><th>총 베팅</th><th>총 지급</th><th>하우스 손익</th><th>환수율</th></tr>${real(rows).map(r => `<tr><td>${G[r.game] || r.game}</td><td>${full(r.plays)}</td><td>${fmt(r.wager)}</td><td>${fmt(r.payout)}</td><td class="${r.wager - r.payout >= 0 ? 'green' : 'red'}">${fmt(r.wager - r.payout)}</td><td>${r.wager ? (r.payout / r.wager * 100).toFixed(1) + '%' : '-'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">기록 없음</td></tr>'}</table></div>`;
    el.innerHTML = `<div class="adm-grid"><div class="kpi"><small>전체 회원</small><b>${full(d.users)}</b></div><div class="kpi"><small>지금 접속</small><b class="green">${full(d.online)}</b></div><div class="kpi"><small>오늘 가입</small><b>${full(d.newbies)}</b></div><div class="kpi"><small>유통 중인 G</small><b class="gold">${fmt(d.money)}</b></div>
      <div class="kpi"><small>오늘 베팅</small><b>${fmt(t.w)}</b></div><div class="kpi"><small>오늘 하우스 손익</small><b class="${t.w - t.p >= 0 ? 'green' : 'red'}">${fmt(t.w - t.p)}</b></div><div class="kpi"><small>7일 하우스 손익</small><b class="${w.w - w.p >= 0 ? 'green' : 'red'}">${fmt(w.w - w.p)}</b></div><div class="kpi"><small>잭팟 적립금</small><b class="gold">${fmt(d.jackpot)}</b></div></div>
      <div class="sec"><h2>Today</h2><small>오늘 게임별</small><div class="rule"></div></div>${tbl(d.today)}
      <div class="sec"><h2>7 Days</h2><small>최근 7일 게임별 · 홀덤·섯다는 유저끼리라 손익 0이 정상</small><div class="rule"></div></div>${tbl(d.week)}
      <div class="sec"><h2>Celestial 77</h2><small>오늘 ${d.draw.count}/77개 열림 · 지급 ${fmt(d.draw.picks.reduce((a, p) => a + p.prize, 0))}G</small><div class="rule"></div></div><div class="tw"><table class="t"><tr><th>등수</th><th>번호</th><th>회원</th><th>보상</th><th>시간</th></tr>${d.draw.picks.filter(p => p.rank <= 4).map(p => `<tr><td>${p.rank}등</td><td>${p.n}</td><td>${esc(p.nick)}</td><td class="gold">${fmt(p.prize)}</td><td>${dt(p.ts)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">아직 4등 이상 당첨 없음</td></tr>'}</table></div>
      <div class="sec"><h2>Big Wins</h2><small>7일 내 20배 이상</small><div class="rule"></div></div><div class="tw"><table class="t"><tr><th>시간</th><th>회원</th><th>게임</th><th>베팅</th><th>당첨</th><th>내용</th></tr>${d.big.map(b => `<tr><td>${dt(b.ts)}</td><td>${esc(b.nick)}</td><td>${G[b.game] || b.game}</td><td>${fmt(b.wager)}</td><td class="gold">${fmt(b.payout)}</td><td class="muted">${esc(b.note)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">없음</td></tr>'}</table></div>`;
  }

  async function users(el) {
    el.innerHTML = `<div class="row" style="margin-bottom:10px"><input class="inp" id="us" placeholder="닉네임 검색"><select class="inp" id="uo" style="flex:0 0 140px"><option value="bal">잔액순</option><option value="recent">최근 접속순</option><option value="new">가입순</option></select></div><div id="ul"></div>`;
    const load = async () => {
      const r = await api('admin/users', { search: $('#us').value, sort: $('#uo').value });
      $('#ul').innerHTML = `<div class="tw"><table class="t"><tr><th>닉네임</th><th>잔액</th><th>최고</th><th>최근 접속</th><th>가입</th><th>상태</th></tr>${r.users.map(u => `<tr class="click" data-id="${esc(u.id)}"><td><b>${esc(u.nick)}</b></td><td class="gold">${fmt(u.bal)}</td><td>${fmt(u.peak)}</td><td>${dt(u.last_seen)}</td><td>${dt(u.created)}</td><td>${u.admin ? '<span class="pill">관리자</span> ' : ''}${u.banned ? '<span class="pill r">정지</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">없음</td></tr>'}</table></div>`;
    };
    let t; $('#us').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); }; $('#uo').onchange = load;
    $('#ul').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) detail(tr.dataset.id, load); };
    load();
  }
  async function detail(id, reload) {
    $$('.drawer,.rx-dim').forEach(x => x.remove());
    const dim = document.createElement('div'); dim.className = 'rx-dim'; const d = document.createElement('div'); d.className = 'drawer';
    document.body.append(dim, d); const close = () => { dim.remove(); d.remove(); }; dim.onclick = close;
    const render = async () => {
      const r = await api('admin/user', { id }), u = r.user;
      d.innerHTML = `<div class="row" style="align-items:flex-start"><div><div class="muted" style="font-size:11px;letter-spacing:.2em">MEMBER</div><h2 class="kserif" style="margin:4px 0">${esc(u.nick)}</h2><div class="muted" style="font-size:12px">가입 ${dt(u.created)} · 최근 ${dt(u.last_seen)}</div></div><button class="btn dark sm" style="flex:0 0 auto" id="dx">닫기</button></div>
        <div class="kv" style="margin-top:14px"><div><small>잔액</small><b class="gold">${full(u.bal)}</b></div><div><small>최고 잔액</small><b>${fmt(u.peak)}</b></div></div>
        <div class="grid2" style="margin-top:10px"><button class="btn gold" data-x="give">지급 / 회수</button><button class="btn line" data-x="set">잔액 직접 설정</button><button class="btn line" data-x="pw">비밀번호 초기화</button><button class="btn ${u.banned ? 'emerald' : 'ruby'}" data-x="ban">${u.banned ? '정지 해제' : '이용 정지'}</button><button class="btn dark" data-x="adm" style="grid-column:1/-1">${u.admin ? '관리자 권한 해제' : '관리자로 지정'}</button></div>
        <div class="sec"><h2>Summary</h2><small>게임별</small><div class="rule"></div></div><div class="tw"><table class="t"><tr><th>게임</th><th>판</th><th>베팅</th><th>지급</th><th>손익</th></tr>${r.summary.map(s => `<tr><td>${G[s.game] || s.game}</td><td>${s.plays}</td><td>${fmt(s.wager)}</td><td>${fmt(s.payout)}</td><td class="${s.payout - s.wager >= 0 ? 'green' : 'red'}">${fmt(s.payout - s.wager)}</td></tr>`).join('')}</table></div>
        <div class="sec"><h2>Ledger</h2><small>최근 80건</small><div class="rule"></div></div><div class="tw"><table class="t"><tr><th>시간</th><th>게임</th><th>베팅</th><th>지급</th><th>내용</th></tr>${r.ledger.map(l => `<tr><td>${dt(l.ts)}</td><td>${G[l.game] || l.game}</td><td>${fmt(l.wager)}</td><td>${fmt(l.payout)}</td><td class="muted">${esc(l.note)}</td></tr>`).join('')}</table></div>`;
      $('#dx', d).onclick = close;
      $$('[data-x]', d).forEach(b => b.onclick = async () => {
        try {
          const x = b.dataset.x;
          if (x === 'give') { const v = await ask('지급 / 회수', `<p>양수는 지급, 음수는 회수입니다. 예: 100000000 = 1억 지급, -50000000 = 5천만 회수</p><input class="inp" name="amount" type="number" placeholder="금액 (G)"><input class="inp" name="memo" placeholder="메모 (선택)" style="margin-top:8px">`, '실행'); if (!v) return; await api('admin/adjust', { id, amount: Number(v.amount), memo: v.memo }); toast('처리됐어요'); }
          if (x === 'set') { const v = await ask('잔액 직접 설정', `<p>현재 ${full(u.bal)}G</p><input class="inp" name="balance" type="number" value="${u.bal}">`, '설정'); if (!v) return; await api('admin/setbal', { id, balance: Number(v.balance) }); toast('설정됐어요'); }
          if (x === 'pw') { if (!(await ask('비밀번호 초기화', `${esc(u.nick)}님의 비밀번호를 임시 번호로 바꿉니다. 기존 로그인은 모두 끊겨요.`, '초기화', true))) return; const r2 = await api('admin/resetpw', { id }); await ask('임시 비밀번호', `<p>회원에게 전달해 주세요.</p><div class="bigx foil">${esc(r2.temp)}</div>`, '확인'); }
          if (x === 'ban') { if (!(await ask(u.banned ? '정지 해제' : '이용 정지', u.banned ? '다시 이용할 수 있게 합니다.' : '로그인이 즉시 끊기고 접속할 수 없게 됩니다.', u.banned ? '해제' : '정지', !u.banned))) return; await api('admin/ban', { id, banned: !u.banned }); toast('처리됐어요'); }
          if (x === 'adm') { if (!(await ask('관리자 권한', u.admin ? '관리자 권한을 해제합니다.' : '이 회원에게 관리자 권한을 줍니다. 모든 회원의 잔액을 바꿀 수 있게 돼요.', '확인', true))) return; await api('admin/setadmin', { id, admin: !u.admin }); toast('처리됐어요'); }
          await render(); reload && reload();
        } catch (er) { toast(er.message, true); }
      });
    };
    render();
  }

  async function games(el) {
    const d = await api('admin/dashboard'), s = d.settings;
    el.innerHTML = `<div class="sec" style="margin-top:6px"><h2>Games</h2><small>끄면 즉시 '점검 중'으로 막혀요</small><div class="rule"></div></div>
      <div class="gtog">${Object.keys(G).filter(k => !['bonus', 'admin'].includes(k)).map(k => `<label>${G[k]}<span class="tog"><input type="checkbox" data-g="${k}" ${s.disabled && s.disabled[k] ? '' : 'checked'}><i></i></span></label>`).join('')}</div>
      <div class="sec"><h2>Notice</h2><small>로비 상단 공지</small><div class="rule"></div></div><textarea class="inp" id="nt" style="height:90px;padding:12px;resize:vertical" maxlength="200" placeholder="비워 두면 공지가 숨겨져요">${esc(s.notice || '')}</textarea>
      <button class="btn gold wide" id="sv" style="margin-top:10px">게임 설정·공지 저장</button>
      <div class="sec"><h2>Jackpot</h2><small>현재 ${full(d.jackpot)}G · 최소 10억</small><div class="rule"></div></div><div class="row"><input class="inp" id="jp" type="number" value="${d.jackpot}"><button class="btn line" id="jps" style="flex:0 0 120px">잭팟 변경</button></div>`;
    $('#sv').onclick = async () => { const disabled = Object.fromEntries($$('[data-g]', el).map(i => [i.dataset.g, !i.checked])); try { await api('admin/settings', { disabled, notice: $('#nt').value }); toast('저장됐어요'); } catch (e) { toast(e.message, true); } };
    $('#jps').onclick = async () => { try { await api('admin/jackpot', { value: Number($('#jp').value) }); toast('잭팟을 바꿨어요'); } catch (e) { toast(e.message, true); } };
  }
  async function tables(el) {
    const d = await api('admin/dashboard');
    el.innerHTML = `<div class="muted" style="font-size:12.5px;margin:4px 2px 10px;line-height:1.6">테이블이 멈췄거나 문제가 생기면 초기화하세요. 앉아 있는 모든 사람의 칩과 이번 판에 건 금액이 각자 지갑으로 환불됩니다.</div><div class="tw"><table class="t"><tr><th>테이블</th><th>게임</th><th>인원</th><th>플레이어</th><th></th></tr>${d.tables.map(t => `<tr><td><b>${esc(t.name)}</b></td><td>${G[t.game]}</td><td>${t.players}/${t.seats}</td><td class="muted">${t.nicks.map(esc).join(', ')}</td><td><button class="btn ruby sm" data-r="${t.id}">초기화</button></td></tr>`).join('')}</table></div>`;
    $$('[data-r]', el).forEach(b => b.onclick = async () => { if (!(await ask('테이블 초기화', '모든 칩을 환불하고 테이블을 비웁니다.', '초기화', true))) return; try { const r = await api('admin/table', { id: b.dataset.r }); toast(`${r.refunded}명 환불 완료`); tables(el); } catch (e) { toast(e.message, true); } });
  }
  async function log(el) {
    const r = await api('admin/log');
    const A = { claim: '권한 연결', adjust: '지급/회수', setbal: '잔액 설정', ban: '정지', unban: '정지 해제', resetpw: '비번 초기화', grant: '관리자 지정', revoke: '관리자 해제', settings: '설정 변경', jackpot: '잭팟 변경', table_reset: '테이블 초기화' };
    el.innerHTML = `<div class="tw"><table class="t"><tr><th>시간</th><th>관리자</th><th>작업</th><th>내용</th></tr>${r.log.map(l => `<tr><td>${dt(l.ts)}</td><td>${esc(l.admin)}</td><td>${A[l.action] || l.action}</td><td class="muted" style="max-width:380px;word-break:break-all">${esc(l.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">기록 없음</td></tr>'}</table></div>`;
  }
  boot();
})();
