/* Membership tiers (frames, card, lounge) and CELESTIAL 77 */
(function () {
  'use strict';
  const { $, $$, esc, fmt, full, App, GET, POST, toast, sfx, register, modal, store } = S2;
  const FRAME = ['스탠다드', '실버 문 링', '골드 링', '플래티넘 다이아 링', '셀레스티아 오비트', '천상의 후광'];
  const EN = ['STARLIGHT', 'MOONLIGHT', 'GOLD', 'PLATINUM', 'CELESTIA ROYAL', 'HEAVEN SENT'];
  const tiers = () => (App.info && App.info.tiers) || [];
  const tierName = i => (tiers()[i] || {}).name || '';
  // avatar wrapped in its tier frame
  S2.framed = (tier, avatar, nick) => `<div class="fr t${tier || 0}">${ICON.avatar(avatar, nick)}</div>`;
  S2.tierChip = t => `<span class="tierchip t${t}">${['✦', '☾', '♛', '◆', '✺', '👑'][t] || '✦'} ${esc(tierName(t))}</span>`;
  S2.nickCls = t => t >= 5 ? 'nk5' : t >= 4 ? 'nk4' : '';

  function perks(i) {
    const t = tiers()[i]; if (!t) return [];
    const p = [`출석 보너스 ${fmt(t.daily)}G`, `셀레스티얼 77 하루 ${t.draws}회`];
    if (t.comp) p.push(`컴프 스핀 매일 ${t.comp}회 (회당 ${fmt(t.compBet)}G 무료 베팅)`);
    if (i >= 1) p.push(`아바타 프레임 · ${FRAME[i]}`);
    if (t.vip) p.push('VIP 테이블 입장 (셀레스티아 VIP 홀덤 · 하늘 위의 판 섯다)');
    if (i >= 3) p.push('전용 리액션 · ' + (i >= 5 ? '하늘이 내려준 자 등판 · 천상의 축복' : i >= 4 ? '로열의 품격' : '샴페인 한 잔 · VIP 라운지 입장'));
    if (t.entrance) p.push(i >= 5 ? '입장 시 로비에 금빛 입장 알림' : '입장 시 로비에 로열 입장 알림');
    if (i >= 4) p.push('닉네임 ' + (i >= 5 ? '골드 포일 · 빛나는 효과' : '바이올렛 컬러'));
    return p;
  }
  S2.tierPerks = perks;
  const cardNo = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return String(h % 10000).padStart(4, '0'); };
  S2.memberCard = me => {
    const d = new Date(me.created || Date.now());
    const seal = me.rank >= 4 ? ICON.emblem().replace('class="emb"', 'class="seal"') : '';
    return `<div class="mcard mc${me.rank}"><div class="bg"></div><div class="top">${ICON.crest()}<span class="house">MAISON CELESTIA</span><span class="tier">${EN[me.rank]}</span></div><div class="emv"></div>${seal}
      <div class="nm ${me.rank >= 4 ? 'foil' : ''}">${esc(me.nick)}</div><div class="tn">${esc(me.rankName)} · SINCE ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}</div><div class="no">•••• ${cardNo(me.id)}</div></div>`;
  };
  S2.lounge = me => `<div class="lounge">${tiers().map((t, i) => `<div class="tierrow ${i === me.rank ? 'cur' : ''} ${i > me.rank ? 'lock' : ''}"><div class="sw mc${i}"><div class="bg"></div></div><div style="flex:1;min-width:0"><div><b>${esc(t.name)}</b><span class="at">${i ? '보유 ' + fmt(t.at) + 'G 이상' : '기본 등급'}</span></div><ul>${perks(i).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div><div class="st">${i === me.rank ? 'CURRENT' : i < me.rank ? '✓' : '🔒'}</div></div>`).join('')}</div>`;

  // ================= CELESTIAL 77 =================
  const TITLE_KO = { SUPREME: '수프림', ROYAL: '로열', GRAND: '그랜드', MAJOR: '메이저', BLESSING: '블레싱' };
  let dV = null;
  register('draw', {
    async mount(el) {
      el.innerHTML = `<button class="back" data-go="lobby">${ICON.back()} 로비</button><div class="title"><div><h1 class="foil">Celestial 77</h1><div class="sub">DAILY CONSTELLATION · 오늘의 별자리</div></div></div>
        <div class="panel deco" style="padding:14px"><div class="muted" style="font-size:12px;line-height:1.6;margin-bottom:10px">밤하늘의 별 77개 뒤에 오늘의 보상이 숨어 있어요. 누군가 가져간 별은 다른 사람이 고를 수 없어요. 매일 자정(한국시간)에 새로 섞입니다.</div><div class="c77-prizes" id="pz"></div></div>
        <div class="c77-bar" id="bar">불러오는 중…</div>
        <div class="sky77"><div class="stars" id="st"></div></div>
        <div class="sec"><h2>Fortunate</h2><small>오늘의 1·2·3등</small><div class="rule"></div></div><div class="c77-win" id="wn"></div>
        <details class="rules"><summary>등급별 하루 횟수</summary><div class="panel">${tiers().map((t, i) => `${esc(t.name)} ${t.draws}회`).join(' · ')}<br>별을 고르는 즉시 보상이 지갑에 들어옵니다. 이미 열린 별에는 그 별의 등급 색이 표시돼요.</div></details>`;
      let st = null, alive = true, busy = false;
      const render = () => {
        $('#pz', el).innerHTML = st.prizes.map(p => `<div class="c77-p ${p.left ? '' : 'gone'}"><div class="md r${p.rank}">${p.rank}</div><div class="tt">${p.title}<small>${p.rank}등 · ${TITLE_KO[p.title]} · 남은 별 ${p.left}/${p.count}</small></div><div class="pz ${p.rank <= 2 ? 'foil' : ''}">${fmt(p.prize)} G</div></div>`).join('');
        const t = new Map(st.taken.map(x => [x.n, x]));
        $('#st', el).innerHTML = Array.from({ length: 77 }, (_, i) => { const n = i + 1, x = t.get(n); return `<button class="star ${x ? 'tk r' + x.rank : ''} ${x && x.mine ? 'mine' : ''}" data-n="${n}" ${x || !st.left ? 'disabled' : ''} title="${x ? esc(x.nick) + ' · ' + x.rank + '등' : n + '번'}">${n}</button>`; }).join('');
        $('#wn', el).innerHTML = st.winners.length ? st.winners.map(w => `<div class="li"><div class="c77-p" style="padding:0;border:0;background:none"><div class="md r${w.rank}">${w.rank}</div></div><div class="m"><b>${esc(w.nick)}</b><small>${w.n}번 별 · ${S2.ago(w.ts)}</small></div><div class="v gold">+${fmt(w.prize)}</div></div>`).join('') : '<div class="empty">아직 큰 별을 찾은 사람이 없어요.<br>SUPREME 별은 1,000억 G예요.</div>';
        tick();
      };
      const tick = () => { if (!st) return; const left = Math.max(0, st.resetAt - S2.now()), h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000), s = Math.floor(left % 60000 / 1000); $('#bar', el).innerHTML = `<span>남은 별 <b>${st.remaining}</b>/77</span><span>나의 선택 <b>${st.max - st.left}</b>/${st.max}</span><span style="margin-left:auto" class="muted">리셋 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}</span>`; };
      const load = async () => { st = await GET('draw'); render(); };
      $('#st', el).onclick = async e => {
        const b = e.target.closest('.star'); if (!b || b.disabled || busy) return; busy = true; sfx('click');
        try {
          const r = await POST('draw/pick', { number: +b.dataset.n });
          sfx(r.rank <= 3 ? 'big' : 'win');
          modal(`<div class="reveal"><div class="muted" style="font-size:11px;letter-spacing:.3em">STAR No. ${r.number}</div><div class="orb r${r.rank}">${r.rank}</div><div class="ti foil">${r.title}</div><div class="muted" style="font-size:12px">${r.rank}등 · ${TITLE_KO[r.title]}</div><div class="pz">+${full(r.prize)} G</div><button class="btn gold wide" style="margin-top:18px" data-x>받기</button></div>`, (m, close) => m.querySelector('[data-x]').onclick = close);
          if (r.rank <= 3) S2.bigWin(r.prize, 0, r.title);
          await load(); S2.refreshMe();
        } catch (er) { toast(er.message, true); await load(); } finally { busy = false; }
      };
      const iv = setInterval(() => { if (!document.hidden) tick(); }, 1000);
      const pv = setInterval(() => { if (!document.hidden && alive && !busy) load().catch(() => {}); }, 8000);
      dV = { stop() { alive = false; clearInterval(iv); clearInterval(pv); } };
      try { await load(); } catch (e) { $('#bar', el).textContent = e.message; }
    },
    unmount() { if (dV) dV.stop(); dV = null; }
  });
})();
