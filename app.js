/* 로또 노트 — 정적 PWA. data/draws.json(전체 회차)·data/analysis.json(scripts/update.py, 매주)만 읽는다.
 * 원칙: 매 회 독립 추첨. 분석법 '승률'은 표본외 역검증으로 보이고, 효과 없음을 숨기지 않는다.
 * 추천 번호 = 무작위 + 많이 고르는 모양 피하기(확률은 같고 1등이면 나눠 가질 사람이 적은 쪽) + 역대 1등 조합 제외. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('ko-KR', {minimumFractionDigits: d, maximumFractionDigits: d});
const won = (n) => n ? (n >= 1e8 ? fmt(n / 1e8, 1) + '억 원' : fmt(n) + '원') : '-';
const LS = {
  get(k, d){ try{ const v = localStorage.getItem('lt.' + k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('lt.' + k, JSON.stringify(v)); }catch(e){} },
};
const color = (n) => n <= 10 ? 'c1' : n <= 20 ? 'c2' : n <= 30 ? 'c3' : n <= 40 ? 'c4' : 'c5';
const ball = (n, cls = '') => `<span class="ball ${color(n)} ${cls}">${n}</span>`;
function toast(t){ document.querySelectorAll('.toast').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
// 긴 설명은 접어 둔다(기본 닫힘) — 제목만 보이고 누르면 펼침
const fold = (title, html) => `<details class="fold"><summary>${title}</summary><div class="fold-b">${html}</div></details>`;

// ---------------------------------------------------------------- 아래 창·확인창 (소은이 앱 방식: 폰 기본 confirm 대신, 뒤로가기로 닫힘)
function openSheet(html, onMount){
  closeSheet(true);
  const w = document.createElement('div'); w.className = 'sheet-wrap'; w.id = 'sheet';
  w.innerHTML = `<div class="sheet-bg"></div><div class="sheet"><div class="grab"></div>${html}</div>`;
  document.body.appendChild(w); document.documentElement.classList.add('shopen');
  requestAnimationFrame(() => w.classList.add('on'));
  w.querySelector('.sheet-bg').onclick = () => closeSheet();
  // 손잡이를 아래로 끌면 닫힘
  const sh = w.querySelector('.sheet'), g = w.querySelector('.grab'); let y0 = null;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointermove', e => { if(y0 != null) sh.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  g.addEventListener('pointerup', e => { const d = e.clientY - (y0 ?? e.clientY); y0 = null; sh.style.transform = ''; if(d > 80) closeSheet(); });
  onMount && onMount(w);
  return w;
}
function closeSheet(now){
  const w = $('sheet'); if(!w) return false;
  document.documentElement.classList.remove('shopen');
  if(now){ w.remove(); return true; }
  w.classList.remove('on'); setTimeout(() => w.remove(), 220); return true;
}
function ask(msg, {ok = '확인', danger = false} = {}){
  return new Promise(res => {
    openSheet(`<p class="ask-msg">${esc(msg)}</p><div class="row ask-row"><button class="btn ghost" data-a="0" type="button">취소</button><button class="btn ${danger ? 'danger' : ''}" data-a="1" type="button">${esc(ok)}</button></div>`,
      w => w.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { closeSheet(); res(b.dataset.a === '1'); }));
  });
}

let D = [], A = null, view = LS.get('view', 'home'), anaSeg = LS.get('anaSeg', 'rank');

// ---------------------------------------------------------------- 추첨 일정 (매주 토 20:35 KST, 생방송 약 20:35~20:45)
const KST = 9 * 3600e3;
const drawTime = (dateStr) => new Date(Date.parse(dateStr + 'T20:35:00+09:00'));
function schedule(){
  const last = D[D.length - 1];
  let no = last.no + 1, t = new Date(drawTime(last.date).getTime() + 7 * 864e5);
  const now = Date.now();
  // 결과가 아직 안 들어온 지난 추첨은 '집계 중'
  const pending = now >= t.getTime();
  while(now >= t.getTime() + 864e5 * 7){ no++; t = new Date(t.getTime() + 7 * 864e5); }
  const live = now >= t.getTime() - 5 * 60e3 && now <= t.getTime() + 15 * 60e3;
  return {no, t, pending, live};
}
const two = (n) => String(n).padStart(2, '0');
function countdown(t){
  const s = Math.max(0, Math.floor((t - Date.now()) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d}일 ${two(h)}:${two(m)}:${two(s % 60)}` : `${two(h)}:${two(m)}:${two(s % 60)}`;
}
const LINKS = {
  onair: 'https://onair.imbc.com/',
  result: 'https://www.dhlottery.co.kr/gameResult.do?method=byWin',
  yt: 'https://www.youtube.com/results?search_query=' + encodeURIComponent('로또 6/45 추첨 방송'),
};

// ---------------------------------------------------------------- 번호 만들기
function feats(s){
  s = [...s].sort((a, b) => a - b);
  const diffs = new Set();
  for(let i = 0; i < 6; i++) for(let j = i + 1; j < 6; j++) diffs.add(s[j] - s[i]);
  return {odd: s.filter(x => x % 2).length, low: s.filter(x => x <= 22).length, sum: s.reduce((a, b) => a + b, 0),
    consec: s.slice(1).filter((x, i) => x - s[i] === 1).length, ac: diffs.size - 5};
}
// 많이 고르는 모양: 모두 31 이하(생일), 연속 2쌍↑, 등차, 7칸 줄 2개 이하에 몰림 (update.py crowdy 와 같게)
function crowdy(s){
  const f = feats(s), step = s[1] - s[0];
  return s.every(x => x <= 31) || f.consec >= 2 || s.every((x, i) => i === 0 || x - s[i - 1] === step) || new Set(s.map(x => Math.floor((x - 1) / 7))).size <= 2;
}
const passFilter = (f) => f.odd >= 2 && f.odd <= 4 && f.low >= 2 && f.low <= 4 && f.sum >= 100 && f.sum <= 175 && f.consec <= 1 && f.ac >= 7;
function rand6(){
  const a = Array.from({length: 45}, (_, i) => i + 1), r = new Uint32Array(45);
  crypto.getRandomValues(r);
  for(let i = 44; i > 0; i--){ const j = r[i] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, 6).sort((x, y) => x - y);
}
function gen(o){
  const past = new Set(D.map(d => d.n.join()));
  for(let t = 0; t < 5000; t++){
    const s = rand6();
    if(o.crowd && crowdy(s)) continue;
    if(o.filter && !passFilter(feats(s))) continue;
    if(past.has(s.join())) continue;
    return s;
  }
  return rand6();
}

// ---------------------------------------------------------------- 내 복권
const Tickets = {
  all(){ return LS.get('tickets', []); },
  save(list){ LS.set('tickets', list); paintBadge(); },
  add(t){ const l = this.all(); l.unshift({id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), ...t}); this.save(l); },
  remove(id){ this.save(this.all().filter(t => t.id !== id)); },
};
function judge(line, d){
  const m = line.filter(x => d.n.includes(x)).length, b = line.includes(d.b);
  const rank = m === 6 ? 1 : m === 5 && b ? 2 : m === 5 ? 3 : m === 4 ? 4 : m === 3 ? 5 : 0;
  const prize = {1: d.p1, 2: d.p2, 3: d.p3, 4: 50000, 5: 5000}[rank] || 0;
  return {m, b, rank, prize};
}
function paintBadge(){
  if(!D.length){ return; }
  const last = D[D.length - 1].no, seen = LS.get('seenDraw', 0);
  $('tkBadge').hidden = !Tickets.all().some(t => t.draw <= last && t.draw > seen);
}

// 복권 QR: 'v=' 뒤 회차 4자리 + 게임마다 [문자 1개 + 번호 6개 × 2자리], 끝에 일련번호. 문자 m=수동 · s=반자동 · q=자동(그 밖은 '선택')
const KIND = {m: '수동', s: '반자동', q: '자동'};
function parseQR(text){
  const v = /[?&]v=(\d{4})([a-z0-9]+)/i.exec(text || '');
  if(!v) return null;
  const draw = +v[1], lines = [], kinds = [];
  const re = /([a-z])(\d{12})/gi;
  let g;
  while((g = re.exec(v[2])) && lines.length < 5){
    const nums = g[2].match(/\d\d/g).map(Number);
    if(nums.every(n => n >= 1 && n <= 45) && new Set(nums).size === 6){ lines.push(nums.sort((a, b) => a - b)); kinds.push(KIND[g[1].toLowerCase()] || '선택'); }
  }
  return lines.length ? {draw, lines, kinds} : null;
}
async function decodeImage(file){
  const img = await createImageBitmap(file);
  if('BarcodeDetector' in window){
    try{
      const r = await new BarcodeDetector({formats: ['qr_code']}).detect(img);
      if(r[0]?.rawValue) return r[0].rawValue;
    }catch(e){}
  }
  if(!window.jsQR) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'lib/jsQR.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  for(const w of [1600, 1000, 700]){   // 큰 사진은 줄여서 여러 크기로 시도
    const sc = Math.min(1, w / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
    const q = window.jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    if(q?.data) return q.data;
  }
  return null;
}
$('scanFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if(!f) return;
  toast('QR 읽는 중…');
  try{
    const txt = await decodeImage(f);
    const p = parseQR(txt);
    if(!p){ toast(txt ? '로또 QR이 아닙니다' : 'QR을 찾지 못했습니다. 밝은 곳에서 QR만 크게 찍어 주세요'); return; }
    if(Tickets.all().some(t => t.qr === txt)){ toast('이미 넣은 복권입니다'); return; }
    Tickets.add({draw: p.draw, lines: p.lines, kinds: p.kinds, src: 'QR', qr: txt});
    toast(`${p.draw}회 ${p.lines.length}게임 저장`);
    show('tickets');
  }catch(err){ toast('사진을 읽지 못했습니다'); }
};

// ---------------------------------------------------------------- 홈
let timer = null, poll = null;
function renderHome(){
  const last = D[D.length - 1], sc = schedule();
  const recO = LS.get('recOpts', {crowd: true, filter: false});
  let rec = LS.get('rec', null);
  if(!rec || rec.draw !== sc.no){ rec = {draw: sc.no, lines: Array.from({length: 5}, () => gen(recO))}; LS.set('rec', rec); }
  const mineNext = Tickets.all().filter(t => t.draw === sc.no).reduce((a, t) => a + t.lines.length, 0);
  $('main').innerHTML = `
    <section class="card hero">
      ${sc.pending ? `<div class="row" style="margin:0 0 6px;">${sc.live ? '<span class="live">LIVE 추첨 중</span>' : '<span class="pill wait">결과 집계 중</span>'}</div>
        <div class="k">${sc.no}회 추첨 끝 · 결과가 곧 들어옵니다</div>`
      : `<div class="k">${sc.no}회 추첨까지 · ${sc.t.getMonth() + 1}월 ${sc.t.getDate()}일(토) 20:35</div><div class="big" id="cd">${countdown(sc.t)}</div>`}
      <div class="row">
        <a class="btn gold sm" href="${LINKS.onair}" target="_blank" rel="noopener">📺 MBC 생방송</a>
        <a class="btn ghost sm" href="${LINKS.result}" target="_blank" rel="noopener">공식 당첨결과</a>
        <a class="btn ghost sm" href="${LINKS.yt}" target="_blank" rel="noopener">지난 방송</a>
      </div>
      ${mineNext ? `<div class="k" style="margin-top:10px;">이번 회차 내 복권 ${mineNext}게임</div>` : ''}
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between;"><h2>${last.no}회 당첨번호</h2><span class="cap" style="margin:0;">${esc(last.date)}</span></div>
      <div class="balls" style="margin:8px 0;">${last.n.map(n => ball(n)).join('')}<span class="plus">+</span>${ball(last.b)}</div>
      <p class="cap" style="margin:0;">1등 ${last.w1 != null ? fmt(last.w1) + '명' : '-'} · 1인당 ${won(last.p1)}</p>
    </section>
    <section class="card">
      <h2>${sc.no}회 추천 번호</h2>
      ${fold('어떻게 고른 번호인가요?', '무작위로 뽑되, 사람들이 많이 고르는 모양(생일 번호만, 연속 여러 쌍, 등차, 한쪽 몰림)과 역대 1등 조합을 뺐습니다. 어떤 번호든 1등 확률은 1/8,145,060로 같아서, 당첨됐을 때 나눠 가질 사람이 적은 쪽을 고르는 것만 의미가 있습니다. 근거는 분석 탭.')}
      <div class="lines">${rec.lines.map((s, i) => `<div class="ln"><span class="lab">${'ABCDE'[i]}</span><span class="balls">${s.map(n => ball(n, 'sm')).join('')}</span></div>`).join('')}</div>
      <label class="opt"><input type="checkbox" id="oFilter" ${recO.filter ? 'checked' : ''}><span>시중 필터도 적용<small>홀짝·고저 2~4, 합 100~175, 연속 1쌍 이하, AC 7↑ · 확률엔 효과 없음</small></span></label>
      <div class="row" style="margin-top:12px;"><button class="btn" id="reGen" type="button">🎲 다시 뽑기</button><button class="btn ghost" id="keep" type="button">내 복권에 담기</button></div>
    </section>`;
  $('reGen').onclick = () => { const o = {crowd: true, filter: $('oFilter').checked}; LS.set('recOpts', o); LS.set('rec', {draw: sc.no, lines: Array.from({length: 5}, () => gen(o))}); renderHome(); };
  $('oFilter').onchange = () => LS.set('recOpts', {crowd: true, filter: $('oFilter').checked});
  $('keep').onclick = () => { Tickets.add({draw: sc.no, lines: LS.get('rec').lines, kinds: Array(5).fill('추천'), src: '추천'}); toast(`${sc.no}회로 5게임 담음 (산 번호와 다르면 지우세요)`); };
  clearInterval(timer);
  if(!sc.pending) timer = setInterval(() => { if($('cd')) $('cd').textContent = countdown(sc.t); else clearInterval(timer); if(Date.now() >= sc.t.getTime()) renderHome(); }, 1000);
  // 추첨 뒤 결과가 들어오기 전엔 2분마다 다시 받아 본다
  clearInterval(poll);
  if(sc.pending) poll = setInterval(async () => { if(document.hidden) return; if(await load() && schedule().no !== sc.no) renderHome(); }, 120e3);
}

// ---------------------------------------------------------------- 내 복권
function renderTickets(){
  const last = D[D.length - 1].no, list = Tickets.all();
  LS.set('seenDraw', last); paintBadge();
  const byDraw = {};
  list.forEach(t => (byDraw[t.draw] = byDraw[t.draw] || []).push(t));
  const draws = Object.keys(byDraw).map(Number).sort((a, b) => b - a);
  let wins = 0, spent = 0, got = 0;
  const blocks = draws.map(no => {
    const d = D[no - 1], ts = byDraw[no];
    return `<section class="card"><div class="row" style="justify-content:space-between;"><h2>${no}회</h2>${d ? `<span class="balls">${d.n.map(n => ball(n, 'sm')).join('')}<span class="plus">+</span>${ball(d.b, 'sm')}</span>` : '<span class="pill wait">추첨 전</span>'}</div>
      ${ts.map(t => `<div class="lines" style="margin-top:10px;">${t.lines.map((s, i) => {
        spent += 1000;
        const j = d ? judge(s, d) : null;
        if(j?.rank){ wins++; got += j.prize; }
        return `<div class="ln"><span class="lab">${'ABCDE'[i]}</span><span class="balls">${s.map(n => ball(n, 'sm' + (d && !d.n.includes(n) && !(j.rank === 2 && n === d.b) ? ' off' : ''))).join('')}</span>
          <span class="res ${j?.rank ? 'win' : 'miss'}">${!j ? esc(t.kinds?.[i] || '') : j.rank ? `${j.rank}등 · ${won(j.prize)}` : `${j.m}개`}</span></div>`;
      }).join('')}</div>
      <div class="row" style="justify-content:space-between; margin-top:6px;"><span class="cap" style="margin:0;">${t.src === 'QR' ? '📷 QR 스캔' : t.src === '추천' ? '추천 담기' : '직접 입력'} · ${new Date(t.at).toLocaleDateString('ko-KR')}</span><button class="btn ghost sm" data-del="${t.id}" type="button">삭제</button></div>`).join('')}
    </section>`;
  }).join('');
  $('main').innerHTML = `<section class="card hero">
      <div class="k">QR만 찍으면 저장 · 추첨 뒤 자동 대조</div>
      <div class="row"><button class="btn gold" id="scan" type="button">📷 QR 스캔</button><button class="btn ghost" id="manual" type="button">✍️ 직접 입력</button></div>
      ${list.length ? `<div class="k" style="margin-top:12px;">지금까지 ${fmt(spent / 1000)}게임 · 당첨 ${wins}번 · ${won(got) === '-' ? '0원' : won(got)}</div>` : ''}
    </section>
    ${blocks || '<div class="empty">아직 저장한 복권이 없습니다.</div>'}`;
  $('scan').onclick = () => $('scanFile').click();
  $('manual').onclick = () => renderManual();
  $('main').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if(await ask('이 복권을 지울까요?', {ok: '지우기', danger: true})){ Tickets.remove(b.dataset.del); renderTickets(); toast('지웠습니다'); } });
}
function renderManual(){
  const sc = schedule(), sel = new Set(), lines = [];
  let drawNo = sc.no;
  openSheet('<div id="mBody"></div>', () => paint());
  function paint(){
    const box = $('mBody'); if(!box) return;
    box.innerHTML = `<h2>직접 입력</h2>
      <div class="row" style="margin:8px 0 12px;"><label class="cap" for="mDraw" style="margin:0;">회차</label><input id="mDraw" type="number" inputmode="numeric" value="${drawNo}" style="width:96px;"><span class="cap" style="margin:0 0 0 auto;">${lines.length + 1}번째 게임 · ${sel.size}/6</span></div>
      <div class="pick">${Array.from({length: 45}, (_, i) => `<button type="button" data-n="${i + 1}" class="${sel.has(i + 1) ? 'on' : ''}">${i + 1}</button>`).join('')}</div>
      ${lines.length ? `<div class="lines" style="margin-top:12px;">${lines.map((s, i) => `<div class="ln"><span class="lab">${'ABCDE'[i]}</span><span class="balls">${s.map(n => ball(n, 'sm')).join('')}</span><button class="x" data-rm="${i}" type="button" aria-label="이 줄 빼기">✕</button></div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:14px;"><button class="btn ghost" id="mCancel" type="button">닫기</button><button class="btn" id="mSave" type="button" ${lines.length ? '' : 'disabled'} style="margin-left:auto;">저장 ${lines.length ? lines.length + '게임' : ''}</button></div>`;
    $('mDraw').oninput = (e) => { drawNo = +e.target.value; };
    box.querySelector('.pick').onclick = (e) => {
      const b = e.target.closest('[data-n]'); if(!b) return;
      const n = +b.dataset.n; sel.has(n) ? sel.delete(n) : sel.add(n);
      if(sel.size === 6){ if(lines.length < 5) lines.push([...sel].sort((a, b) => a - b)); else toast('한 장은 5게임까지'); sel.clear(); }
      paint();
    };
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.rm, 1); paint(); });
    $('mSave').onclick = () => { if(!drawNo || !lines.length) return; Tickets.add({draw: drawNo, lines, kinds: Array(lines.length).fill('직접'), src: '직접'}); closeSheet(); toast(`${drawNo}회 ${lines.length}게임 저장`); renderTickets(); };
    $('mCancel').onclick = () => closeSheet();
  }
}

// ---------------------------------------------------------------- 분석
function renderAnalysis(){
  const segs = [['rank', '🏆 분석법 승률'], ['nums', '🔢 번호 통계'], ['pattern', '🧩 패턴']];
  const body = anaSeg === 'nums' ? anaNums() : anaSeg === 'pattern' ? anaPattern() : anaRank();
  $('main').innerHTML = `<div class="seg" id="seg">${segs.map(([k, t]) => `<button type="button" data-s="${k}" class="${anaSeg === k ? 'on' : ''}">${t}</button>`).join('')}</div>${body}`;
  $('seg').onclick = (e) => { const b = e.target.closest('[data-s]'); if(b){ anaSeg = b.dataset.s; LS.set('anaSeg', anaSeg); renderAnalysis(); } };
  const ss = $('nSort'); if(ss){ ss.value = LS.get('nSort', 'freq'); ss.onchange = () => { LS.set('nSort', ss.value); renderAnalysis(); }; }
}
function anaRank(){
  const B = A.backtest, R = [...B.methods].sort((a, b) => b.ge3 - a.ge3 || b.mean - a.mean);
  const lo = B.theory_ge3 - 1.96 * B.ge3_se, hi = B.theory_ge3 + 1.96 * B.ge3_se;
  const beat = R.filter(m => m.ge3 > hi);
  const E = A.elim || [];
  return `<div class="note"><b>${beat.length ? '무작위보다 확실히 나은 방법이 있습니다' : '1위 방법도 무작위와 구별되지 않습니다'}</b>
      ${fold('자세히', `승률 = 5등 이상(3개↑) 맞은 비율. 무작위 이론값 ${fmt(B.theory_ge3, 2)}%, 운으로 나오는 범위 ${fmt(lo, 2)}~${fmt(hi, 2)}%. 모든 방법이 이 안에 있습니다. '그때그때 승률 1위 방법 따라가기'도 표본외로 시험했지만 같은 범위입니다.`)}</div>
    ${E.length ? `<section class="card"><h2>안 나올 것 같은 조합을 지우면?</h2><p class="cap">지운 조합 비율 = 실제 당첨번호가 그 안에 있던 비율 → 남은 조합의 확률이 오르지 않음</p>
      <table><thead><tr><th>지우는 패턴</th><th class="n">지운 조합</th><th class="n">실제 당첨</th></tr></thead>
      <tbody>${E.map(e => `<tr><td>${esc(e.name)}</td><td class="n">${fmt(e.combo_pct, 2)}%</td><td class="n"><b>${fmt(e.win_pct, 2)}%</b></td></tr>`).join('')}</tbody></table>
      ${fold('왜 그런가요?', `1·3·5·7·9·11 같은 줄은 '그 모양이 드문' 게 아니라 그 모양에 속한 조합 수가 적을 뿐입니다. 한 줄 한 줄의 확률은 모두 1/8,145,060로 같습니다. 그래서 어떤 모양을 지우면 그만큼 당첨번호도 그 안에 있었고(위 두 칸이 같음), 내가 산 한 줄의 확률은 그대로입니다. 지워서 얻는 건 확률이 아니라, 사람들이 많이 고르는 모양(연속·등차·생일)을 피해 당첨금을 덜 나누는 것뿐입니다.`)}</section>` : ''}
    <section class="card"><h2>분석법 승률 순위</h2><p class="cap">${fmt(B.from)}회부터 매 회, 그 직전 기록만 보고 골랐다면 · ${fmt(R[0].draws)}회</p>
      <table><thead><tr><th>방법</th><th class="n">승률</th><th class="n">4등↑</th><th class="n">평균 맞음</th></tr></thead>
      <tbody>${R.map((m, i) => `<tr class="${m.meta ? 'meta' : ''}"><td><span class="rk">${i + 1}</span>${esc(m.name)}${m.meta && m.picked ? `<br><small class="cap">주로 고른 방법: ${esc(m.picked[0][0])}</small>` : ''}</td><td class="n"><b>${fmt(m.ge3, 2)}%</b></td><td class="n">${fmt(m.ge4, 3)}%</td><td class="n">${fmt(m.mean, 3)}</td></tr>`).join('')}</tbody></table>
      ${fold('표 읽는 법', `이론값: 승률 ${fmt(B.theory_ge3, 2)}% · 4등↑ ${fmt(B.theory_ge4, 3)}% · 평균 ${B.theory_mean}개. 순위는 매주 바뀝니다. ${R.length}가지를 비교했으니 1위가 이론값보다 조금 높은 건 우연으로도 정상입니다. 노란 줄은 '그때까지 1위였던 방법을 다음 회차에 쓰기' 전략입니다.`)}</section>`;
}
function anaNums(){
  const sort = LS.get('nSort', 'freq');
  const N = Array.from({length: 45}, (_, i) => ({n: i + 1, f: A.freq[i], r10: A.recent10[i], r50: A.recent50[i], g: A.gap[i]}));
  const key = {no: x => x.n, freq: x => -x.f, r50: x => -x.r50, r10: x => -x.r10, gap: x => -x.g}[sort];
  N.sort((a, b) => key(a) - key(b) || a.n - b.n);
  const mx = {freq: Math.max(...A.freq), r50: Math.max(...A.recent50), r10: Math.max(...A.recent10, 1), gap: Math.max(...A.gap, 1), no: Math.max(...A.freq)}[sort];
  const v = (x) => ({no: x.f, freq: x.f, r50: x.r50, r10: x.r10, gap: x.g}[sort]);
  const unit = sort === 'gap' ? '회째' : '번';
  return `<div class="note"><b>번호별 출현은 무작위 범위 안입니다</b>${fold('자세히', `${fmt(A.n_draws)}회 동안 번호마다 평균 ${fmt(A.freq_expect, 1)}번 (최소 ${Math.min(...A.freq)} · 최대 ${Math.max(...A.freq)}). 카이제곱 ${fmt(A.chi2, 1)} &lt; 무작위 한계 ${fmt(A.chi2_crit, 1)}. 지난 결과일 뿐 다음 회차 확률과는 관계없습니다.`)}</div>
    <section class="card"><div class="row" style="justify-content:space-between; margin-bottom:10px;"><h2>번호별</h2>
      <select id="nSort" style="font:inherit; padding:6px 10px; border-radius:10px; border:1.5px solid var(--line); background:var(--surface); color:var(--text);"><option value="freq">전체 많이 나온 순</option><option value="r50">최근 50회 많이</option><option value="r10">최근 10회 많이</option><option value="gap">오래 안 나온 순</option><option value="no">번호 순</option></select></div>
      <div class="g45">${N.map(x => `<div class="c45">${ball(x.n, 'sm')}<span class="v">${v(x)}${unit}</span><span class="b"><i style="width:${(v(x) / mx * 100).toFixed(0)}%"></i></span></div>`).join('')}</div>
</section>
    <section class="card"><h2>함께 많이 나온 쌍</h2>
      <table><tbody>${A.pairs_top.slice(0, 8).map(([p, c]) => `<tr><td><span class="balls">${p.map(n => ball(n, 'sm')).join('')}</span></td><td class="n">${c}회</td></tr>`).join('')}</tbody></table>
      ${fold('자세히', `쌍 하나의 무작위 기대 ${fmt(A.pair_expect, 1)}회. 쌍이 990개라 이 정도 상위값은 우연으로도 나옵니다.`)}</section>`;
}
const PAT = [['odd', '홀수 개수'], ['low', '낮은 번호(1~22) 개수'], ['sum', '6개 합'], ['consec', '연속 번호 쌍'], ['ac', 'AC값'], ['same_end', '같은 끝수 최대'], ['prime', '소수 개수']];
function anaPattern(){
  const blocks = PAT.map(([k, t]) => {
    const p = A.patterns[k], keys = Object.keys(p.random).filter(x => (p.random[x] || 0) >= 1 || (p.real[x] || 0) >= 1);
    const mx = Math.max(...keys.map(x => Math.max(p.real[x] || 0, p.random[x] || 0)));
    return `<section class="card"><h2>${t}</h2>${keys.map(x => `<div class="pb"><span>${esc(x)}</span><span class="t"><i style="width:${((p.real[x] || 0) / mx * 100).toFixed(1)}%"></i><s style="left:${((p.random[x] || 0) / mx * 100).toFixed(1)}%"></s></span><b>${fmt(p.real[x] || 0, 1)}%</b></div>`).join('')}</section>`;
  }).join('');
  const cr = A.crowd.groups.low31;
  return `<div class="note"><b>모든 패턴이 무작위와 같은 비율입니다</b>${fold('그림 읽는 법', `막대 = 실제 ${fmt(A.n_draws)}회, 금색 선 = 무작위로 20만 번 뽑았을 때. '잘 나오는 패턴'은 원래 조합 수가 많을 뿐, 그 안의 한 줄 확률은 다른 줄과 같습니다.`)}</div>
    ${blocks}
    <section class="card"><h2>이월수 (직전 회차 번호가 다시 나온 개수)</h2><table><tbody>${Object.entries(A.carry).map(([k, v]) => `<tr><td>${k}개</td><td class="n">${fmt(v, 1)}%</td></tr>`).join('')}</tbody></table></section>
    <section class="card"><h2>1등을 나눠 가진 정도</h2><p class="cap">당첨번호 중 31 이하 개수별</p>
      <table><tbody>${Object.entries(cr).map(([k, v]) => `<tr><td>${k}개</td><td class="n">${fmt(v.draws)}회</td><td class="n">×${(v.winners / v.expect).toFixed(2)}</td></tr>`).join('')}</tbody></table>
      ${fold('자세히', '1등 인원 ÷ 무작위 기대(판매 장수 ÷ 8,145,060). 차이가 작고 회차별 편차가 커서 아직 뚜렷하지 않습니다. 금액 쪽 이야기이고 확률과는 무관합니다.')}</section>`;
}

// ---------------------------------------------------------------- 공통
const VIEWS = {home: renderHome, tickets: renderTickets, analysis: renderAnalysis};
function show(v){
  view = VIEWS[v] ? v : 'home'; LS.set('view', view);
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  if(!A){ $('main').innerHTML = '<div class="empty">데이터를 불러오지 못했습니다. 연결을 확인하세요.</div>'; return; }
  VIEWS[view]();
  window.scrollTo(0, 0);
}
$('tabbar').onclick = (e) => { const b = e.target.closest('[data-v]'); if(b) show(b.dataset.v); };
const ORDER = ['home', 'tickets', 'analysis'];
// 휴대폰 뒤로: 위에 열린 것부터 닫고(아래 창 → 다른 탭이면 홈), 홈이면 '한 번 더 누르면 종료' (소은이 앱 방식)
let exitArmed = 0;
const guard = () => { if(!history.state?.guard) history.pushState({guard: 1}, ''); };
history.replaceState({root: 1}, ''); guard();
document.addEventListener('pointerdown', guard, {capture: true});
window.addEventListener('popstate', () => {
  if(closeSheet()){ guard(); return; }
  if(view !== 'home'){ show('home'); guard(); return; }
  if(Date.now() - exitArmed < 2000) return;   // 두 번째: 종료
  exitArmed = Date.now(); toast('한 번 더 누르면 종료돼요'); setTimeout(guard, 0);
});
// 화면을 좌우로 밀면 옆 탭
let sx = null, sy = null;
document.addEventListener('touchstart', e => { const t = e.target; if($('sheet') || t.closest('input, select, .pick, .g45, table, [data-noswipe]')){ sx = null; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, {passive: true});
document.addEventListener('touchend', e => {
  if(sx == null) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
  if(Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
  const i = ORDER.indexOf(view) + (dx < 0 ? 1 : -1);
  if(ORDER[i]){ show(ORDER[i]); $('main').classList.remove('slide-l', 'slide-r'); void $('main').offsetWidth; $('main').classList.add(dx < 0 ? 'slide-l' : 'slide-r'); }
}, {passive: true});
document.addEventListener('contextmenu', e => { if(!e.target.closest('input, textarea')) e.preventDefault(); });
const topBtn = document.createElement('button'); topBtn.className = 'to-top'; topBtn.type = 'button'; topBtn.setAttribute('aria-label', '맨 위로'); topBtn.textContent = '↑'; topBtn.hidden = true;
topBtn.onclick = () => window.scrollTo({top: 0, behavior: 'smooth'}); document.body.appendChild(topBtn);
window.addEventListener('scroll', () => { topBtn.hidden = window.scrollY < 500; }, {passive: true});
async function load(){
  try{
    const [d, a] = await Promise.all(['data/draws.json', 'data/analysis.json'].map(u => fetch(u, {cache: 'no-cache'}).then(r => { if(!r.ok) throw new Error(u); return r.json(); })));
    const grew = !D.length || d.length > D.length;
    D = d; A = a;
    $('dataInfo').textContent = `${fmt(D[D.length - 1].no)}회까지`;
    paintBadge();
    return grew;
  }catch(e){ return false; }
}
(async () => { await load(); show(view); })();
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
