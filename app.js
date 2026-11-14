/* 로또 노트 — 정적 PWA. data/draws.json(전체 회차)·data/analysis.json(scripts/update.py, 매주)만 읽는다.
 * 원칙: 매 회 독립 추첨. 분석법 '승률'은 표본외 역검증으로 보이고, 효과 없음을 숨기지 않는다.
 * 추천 번호 = 무작위 + 많이 고르는 모양 피하기(확률은 같고 1등이면 나눠 가질 사람이 적은 쪽) + 역대 1등 조합 제외. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('ko-KR', {minimumFractionDigits: d, maximumFractionDigits: d});
const won = (n) => n ? (n >= 1e8 ? fmt(n / 1e8, 1) + '억 원' : fmt(n) + '원') : '-';
const LS = {
  get(k, d){ try{ const v = localStorage.getItem('lt.' + k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('lt.' + k, JSON.stringify(v)); }catch(e){} try{ Cloud.kv(k, v); }catch(e){} },
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

let D = [], A = null, view = LS.get('view', 'home'), anaSeg = LS.get('anaSeg', 'week');

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
// 동행복권은 2025년 홈페이지를 바꿔 옛 주소(gameResult.do·TotalGame.jsp)가 오류·빈 화면 → 새 주소만 쓴다(2026-11)
// 구매는 로그인·예치금이 필요해 깊은 주소가 자주 막힘 → 첫 화면으로 보내고 '사는 법'을 접어 둔다
const VER = '1.8.0';
const LINKS = {
  buy: 'https://www.dhlottery.co.kr/',
  onair: 'https://onair.imbc.com/',
  result: 'https://www.dhlottery.co.kr/lt645/result',
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
// 회차마다 고정된 추천: 회차 번호로 씨앗을 정해 누가 언제 열어도 같은 10줄 (다시 뽑기로 바꾸지 않음)
function seeded(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function fixedLines(no, n = 10){
  const r = seeded(no * 2654435761), past = new Set(D.map(d => d.n.join())), out = [], seen = new Set();
  while(out.length < n){
    const a = Array.from({length: 45}, (_, i) => i + 1);
    for(let i = 44; i > 0; i--){ const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const s = a.slice(0, 6).sort((x, y) => x - y), k = s.join();
    if(crowdy(s) || past.has(k) || seen.has(k)) continue;
    // 10줄끼리 3개 넘게 겹치지 않게(같은 번호에 몰리지 않도록)
    if(out.some(o => o.filter(x => s.includes(x)).length > 2)) continue;
    seen.add(k); out.push(s);
  }
  return out;
}
// 나만의 방식 (update.py mine_ok 와 같게) — 1등을 덜 나누는 모양: 32↑ 3~4개, 7칸 줄마다 하나씩 고르게 퍼진 모양 빼기, 튀지 않게 22 이하 1개↑·홀수 1~5·연속 1쌍 이하
function mineOk(s){
  const hi = s.filter(x => x > 31).length, rows = {};
  s.forEach(x => { const r = Math.floor((x - 1) / 7); rows[r] = (rows[r] || 0) + 1; });
  const odd = s.filter(x => x % 2).length;
  return hi >= 3 && hi <= 4 && s.some(x => x <= 22) && odd >= 1 && odd <= 5 && feats(s).consec <= 1 && Math.max(...Object.values(rows)) >= 2;
}
const METHODS = [
  ['mine', '나만의 방식', '1등이 되면 덜 나누는 모양(32 이상 3~4개, 너무 고르게 퍼진 모양 빼기)에, 튀지 않게 평범한 모양만'],
  ['basic', '기본', '많이 고르는 모양(생일 번호만·연속 여러 쌍·등차·한쪽 몰림)을 피해 무작위로'],
  ['random', '완전 무작위', '자동과 같음'],
  ['hot', '핫 번호', '최근 30회 많이 나온 20개 중에서'],
  ['cold', '콜드 번호', '최근 30회 적게 나온 20개 중에서'],
  ['overdue', '미출현 번호', '오래 안 나온 20개 중에서'],
  ['filter', '패턴 맞춤', '홀짝·고저 2~4, 합 100~175, 연속 1쌍 이하, AC 7 이상인 조합만'],
];
try{ if(!localStorage.getItem('lt.prefV2')){ const p = JSON.parse(localStorage.getItem('lt.pref') || '{}'); if(p.method === 'basic'){ p.method = 'mine'; localStorage.setItem('lt.pref', JSON.stringify(p)); } localStorage.setItem('lt.prefV2', '1'); } }catch(e){}
const Pref = {
  get(){ return {method: 'mine', lines: 10, ...LS.get('pref', {})}; },
  set(p){ LS.set('pref', {...this.get(), ...p}); },
};
function methodPick(key){
  const c = (k) => { const m = {}; D.slice(-k).forEach(d => d.n.forEach(x => m[x] = (m[x] || 0) + 1)); return m; };
  const all = Array.from({length: 45}, (_, i) => i + 1);
  let pool = null;
  if(key === 'hot'){ const m = c(30); pool = [...all].sort((a, b) => (m[b] || 0) - (m[a] || 0) || a - b).slice(0, 20); }
  if(key === 'cold'){ const m = c(30); pool = [...all].sort((a, b) => (m[a] || 0) - (m[b] || 0) || a - b).slice(0, 20); }
  if(key === 'overdue'){ const last = {}; D.forEach((d, i) => d.n.forEach(x => last[x] = i)); pool = [...all].sort((a, b) => (last[a] ?? -1) - (last[b] ?? -1) || a - b).slice(0, 20); }
  return {pool, mine: key === 'mine', avoid: key === 'basic' || key === 'mine', filter: key === 'filter', ov: key === 'basic' || key === 'filter' || key === 'mine' ? 2 : key === 'random' ? 6 : 3};
}
// 같은 규칙으로 변형 v 번째 추천(회차·방식·변형으로 씨앗) — 변형 0 이면 update.py 가 만든 값을 그대로
function recLines(no, key, v, n){
  if(!v && A?.rec_next?.[key] && D[D.length - 1].no + 1 === no) return A.rec_next[key].slice(0, n);
  const M = methodPick(key), r = seeded(no * 2654435761 + v * 40503 + key.length * 977), past = new Set(D.map(d => d.n.join())), out = [];
  for(let t = 0; t < 20000 && out.length < n; t++){
    const src = M.pool || Array.from({length: 45}, (_, i) => i + 1), a = [...src];
    for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const s = a.slice(0, 6).sort((x, y) => x - y), k = s.join();
    if(past.has(k) || out.some(o => o.join() === k) || (M.avoid && crowdy(s)) || (M.mine && !mineOk(s)) || (M.filter && !passFilter(feats(s)))) continue;
    if(out.some(o => o.filter(x => s.includes(x)).length > M.ov)) continue;
    out.push(s);
  }
  return out;
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
  add(t){ const l = this.all(), x = {id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), ...t}; l.unshift(x); this.save(l); Cloud.putTicket(x); },
  remove(id){ this.save(this.all().filter(t => t.id !== id)); Cloud.delTicket(id); },
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

// ---------------------------------------------------------------- 같이 보기 (배우자와 같은 화면, 소은이 앱처럼 초대 코드)
// Firebase(bidproject-452e5, 낙찰가 앱과 같은 프로젝트 — 구글 로그인·rew623.github.io 승인 돼 있음)
//   lotto/{rid}                 공간(만든 사람 owner)        lotto/{rid}/members/{uid}  {name, at}
//   lotto/{rid}/tickets/{id}    {t: 복권 JSON 문자열, at}     lotto/{rid}/kv/state       {키: JSON 문자열} — pref·var{회차}·picked…
//   lottoInvites/{코드}         {rid, by, exp(7일)}          users/{uid}/lotto/room     {rid} (내가 들어간 공간)
// Firestore 는 배열 안 배열을 못 넣어 값은 문자열로. 보안 규칙은 docs/같이보기.md (콘솔에 붙여 넣기)
const FB_CONFIG = {
  apiKey: 'AIzaSyD3jJD98w4FP8FDKFkvmA2K54ophlqyws0', authDomain: 'bidproject-452e5.firebaseapp.com', projectId: 'bidproject-452e5',
  storageBucket: 'bidproject-452e5.firebasestorage.app', messagingSenderId: '220864509888', appId: '1:220864509888:web:420d8926f699090f9fba25',
};   // 웹 앱 설정값은 공개돼도 되는 값 — 데이터는 보안 규칙이 지킨다
const FB_VER = '10.12.2';
const SHARED = (k) => k === 'pref' || /^var\d+$/.test(k) || /^picked\d+/.test(k);
const Cloud = {
  user: null, db: null, rid: null, members: [], status: '', loading: null, unsubs: [], q: {},
  kv(k, v){
    if(!this.rid || !SHARED(k)) return;
    this.q[k] = JSON.stringify(v);
    clearTimeout(this._t); this._t = setTimeout(() => this.flush(), 400);
  },
  flush(){
    const q = this.q; this.q = {};
    if(!this.rid || !Object.keys(q).length) return;
    this.room().collection('kv').doc('state').set(q, {merge: true}).catch(e => this.fail(e));
  },
  room(){ return this.db.collection('lotto').doc(this.rid); },
  putTicket(t){ if(this.rid) this.room().collection('tickets').doc(t.id).set({t: JSON.stringify(t), at: t.at}).catch(e => this.fail(e)); },
  delTicket(id){ if(this.rid) this.room().collection('tickets').doc(id).delete().catch(e => this.fail(e)); },
  fail(e){ this.status = '저장 실패: ' + (e.code || e.message); console.warn(e); this.paint(); },
  loadScript(src){ return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Firebase를 불러오지 못했습니다')); document.head.appendChild(s); }); },
  init(){
    if(this.loading) return this.loading;
    this.loading = (async () => {
      const u = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
      await this.loadScript(u + 'firebase-app-compat.js');
      await Promise.all([this.loadScript(u + 'firebase-auth-compat.js'), this.loadScript(u + 'firebase-firestore-compat.js')]);
      firebase.initializeApp(FB_CONFIG);
      this.db = firebase.firestore();
      firebase.auth().onAuthStateChanged(async (user) => {
        this.user = user; this.stop();
        if(user){
          LS.set('cloud', true);
          try{
            const r = await this.db.collection('users').doc(user.uid).collection('lotto').doc('room').get();
            if(r.exists) await this.enter(r.data().rid); else await this.enter(await this.create(), true);
          }catch(e){ this.fail(e); }
        }
        this.paint();
      });
    })().catch(e => { this.loading = null; this.status = e.message; this.paint(); throw e; });
    return this.loading;
  },
  me(){ const u = this.user; return {name: (u.displayName || '나').slice(0, 20), at: Date.now()}; },
  async create(){
    const ref = this.db.collection('lotto').doc();
    await ref.set({owner: this.user.uid, at: Date.now()});
    await ref.collection('members').doc(this.user.uid).set(this.me());
    return ref.id;
  },
  // 공간에 들어가며 이 폰에 있던 복권을 올려 합친다(같은 id·같은 QR은 한 번만). 새로 만든 공간이면 설정도 올림
  async enter(rid, fresh){
    this.rid = rid;
    await this.db.collection('users').doc(this.user.uid).collection('lotto').doc('room').set({rid});
    await this.room().collection('members').doc(this.user.uid).set(this.me(), {merge: true});
    if(fresh){
      const kv = {};
      for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if(k.startsWith('lt.') && SHARED(k.slice(3))) kv[k.slice(3)] = localStorage.getItem(k); }
      if(Object.keys(kv).length) await this.room().collection('kv').doc('state').set(kv, {merge: true});
    }
    {
      const snap = await this.room().collection('tickets').get(), have = new Set(), qrs = new Set();
      snap.forEach(d => { have.add(d.id); try{ const t = JSON.parse(d.data().t); if(t.qr) qrs.add(t.qr); }catch(e){} });
      const b = this.db.batch(); let n = 0;
      for(const t of Tickets.all()) if(!have.has(t.id) && !(t.qr && qrs.has(t.qr)) && n < 400){ b.set(this.room().collection('tickets').doc(t.id), {t: JSON.stringify(t), at: t.at}); n++; }
      if(n) await b.commit();
    }
    this.listen();
  },
  listen(){
    const R = this.room();
    this.unsubs.push(R.collection('tickets').onSnapshot(s => {
      const l = []; s.forEach(d => { try{ l.push(JSON.parse(d.data().t)); }catch(e){} });
      l.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      try{ localStorage.setItem('lt.tickets', JSON.stringify(l)); }catch(e){}
      paintBadge(); this.repaint(['home', 'tickets']);
    }, e => this.fail(e)));
    this.unsubs.push(R.collection('kv').doc('state').onSnapshot(s => {
      if(s.metadata.hasPendingWrites) return;   // 내가 보낸 것
      const d = s.data() || {}; let ch = false;
      for(const [k, v] of Object.entries(d)) if(SHARED(k) && typeof v === 'string' && localStorage.getItem('lt.' + k) !== v){ try{ localStorage.setItem('lt.' + k, v); ch = true; }catch(e){} }
      if(ch) this.repaint(['home', 'settings']);
    }, e => this.fail(e)));
    this.unsubs.push(R.collection('members').onSnapshot(s => { this.members = s.docs.map(d => ({uid: d.id, ...d.data()})); this.paint(); }, () => {}));
  },
  stop(){ this.unsubs.forEach(f => f()); this.unsubs = []; this.rid = null; this.members = []; },
  // 다른 폰이 바꾸면 지금 보는 화면을 다시 그린다(아래 창이 열려 있거나 입력 중이면 건너뜀)
  repaint(views){
    if(!views.includes(view) || $('sheet') || document.activeElement?.matches?.('input, select, textarea') || !A) return;
    const y = window.scrollY; VIEWS[view](); window.scrollTo(0, y);
  },
  async signIn(){
    try{
      if(!window.firebase?.apps?.length){ this.status = '준비 중… 잠시 뒤 다시 눌러 주세요'; this.paint(); await this.init(); }
      const p = new firebase.auth.GoogleAuthProvider();
      try{ await firebase.auth().signInWithPopup(p); }
      catch(e){ if(/popup-blocked|operation-not-supported/.test(e.code || '')) await firebase.auth().signInWithRedirect(p); else throw e; }
      this.status = '';
    }catch(e){ this.status = '로그인 실패: ' + (e.code || e.message); }
    this.paint();
  },
  async signOut(){
    if(!await ask('로그아웃할까요? 이 폰의 복권 목록은 지우고, 같이 보기 공간에는 그대로 남습니다.', {ok: '로그아웃'})) return;
    await this.init(); this.stop(); await firebase.auth().signOut(); LS.set('cloud', false);
    try{ localStorage.removeItem('lt.tickets'); }catch(e){}
    toast('로그아웃했습니다'); show('settings');
  },
  async invite(){
    const A_ = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = new Uint32Array(6); crypto.getRandomValues(r);
    const code = [...r].map(x => A_[x % A_.length]).join('');
    await this.db.collection('lottoInvites').doc(code).set({rid: this.rid, by: this.user.uid, exp: Date.now() + 7 * 864e5});
    return code;
  },
  async join(code){
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if(code.length !== 6) throw new Error('코드 6자리를 넣어 주세요');
    const s = await this.db.collection('lottoInvites').doc(code).get();
    if(!s.exists || s.data().exp < Date.now()) throw new Error('없거나 기간이 지난 코드입니다');
    const rid = s.data().rid;
    if(rid === this.rid) throw new Error('이미 같은 공간입니다');
    this.stop();
    this.rid = rid;
    await this.room().collection('members').doc(this.user.uid).set(this.me());   // 먼저 회원이 돼야 공간을 읽을 수 있음
    await this.enter(rid);
    s.ref.delete().catch(() => {});
  },
  paint(){
    const n = this.members.length, el = $('dataInfo');
    if(el && D.length) el.innerHTML = `${fmt(D[D.length - 1].no)}회까지${this.rid ? `<span class="sync" title="같이 보기">🔗${n > 1 ? ' ' + n + '명' : ''}</span>` : ''}`;
    if(view === 'settings' && $('shareBox')) $('shareBox').innerHTML = shareBox();
  },
};
function shareBox(){
  const C = Cloud;
  if(!C.user) return `<p class="cap">구글로 로그인하면 내 복권·추천 방식·고른 줄이 저장되고, 초대 코드로 배우자와 <b>같은 화면</b>을 봅니다. 한쪽이 QR을 찍으면 다른 폰에도 바로 뜹니다.</p>
    <button class="btn" type="button" data-cloud="in">구글로 로그인</button>${C.status ? `<p class="cap" style="color:var(--red); margin:8px 0 0;">${esc(C.status)}</p>` : ''}`;
  return `<div class="share-st">${C.members.map(m => `<span class="who"><i>${esc((m.name || '?').slice(0, 1))}</i>${esc(m.name || '')}${m.uid === C.user.uid ? ' (나)' : ''}</span>`).join('') || '<span class="cap" style="margin:0;">연결 중…</span>'}</div>
    <p class="cap" style="margin:10px 0;">${C.members.length > 1 ? '이 사람들과 같은 화면을 봅니다.' : '아직 혼자입니다. 초대 코드를 만들어 배우자 폰의 이 화면에 넣게 하세요.'}</p>
    <div class="row"><button class="btn gold" type="button" data-cloud="inv">초대 코드 만들기</button><button class="btn ghost" type="button" data-cloud="join">코드로 들어가기</button></div>
    <div id="invOut"></div>
    ${C.status ? `<p class="cap" style="color:var(--red); margin:8px 0 0;">${esc(C.status)}</p>` : ''}
    <p class="cap" style="margin:12px 0 0;">${esc(C.user.displayName || '')} 로그인 · <button class="pill link" type="button" data-cloud="out">로그아웃</button></p>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cloud]'); if(!b) return;
  const a = b.dataset.cloud;
  if(a === 'in') return Cloud.signIn();
  if(a === 'out') return Cloud.signOut();
  try{
    if(a === 'inv'){ const c = await Cloud.invite(); $('invOut').innerHTML = `<div style="margin-top:12px;"><span class="code">${c}</span><p class="cap" style="margin:6px 0 0;">7일 안에 배우자 폰 → 설정 → '코드로 들어가기'에 입력 · 한 번 쓰면 사라짐</p></div>`; }
    if(a === 'join') openSheet(`<h2>코드로 들어가기</h2><p class="cap">배우자가 만든 6자리 코드. 이 폰의 복권도 그 공간으로 합쳐집니다.</p>
      <input id="jCode" maxlength="8" autocomplete="off" style="font:inherit; font-size:24px; letter-spacing:.15em; text-transform:uppercase; width:100%; padding:10px 12px; border-radius:12px; border:1.5px solid var(--line); background:var(--card); color:var(--text);">
      <div class="row" style="margin-top:14px;"><button class="btn ghost" id="jNo" type="button">닫기</button><button class="btn" id="jOk" type="button" style="margin-left:auto;">들어가기</button></div>`, () => {
        $('jCode').focus(); $('jNo').onclick = () => closeSheet();
        $('jOk').onclick = async () => { try{ await Cloud.join($('jCode').value); closeSheet(); toast('같이 보기 시작!'); show('settings'); }catch(err){ toast(err.message || '들어가지 못했습니다'); } };
      });
  }catch(err){ toast(err.code === 'permission-denied' ? '권한 없음 — 보안 규칙을 넣었는지 확인' : (err.message || '실패')); }
});

// ---------------------------------------------------------------- 홈
let timer = null, poll = null;
function renderHome(){
  const last = D[D.length - 1], sc = schedule();
  const P = Pref.get(), vkey = 'var' + sc.no, v = LS.get(vkey, 0);
  const rec = {draw: sc.no, lines: recLines(sc.no, P.method, v, P.lines)};
  const pkey = `picked${sc.no}.${P.method}.${v}`;
  const picked = new Set(LS.get(pkey, Array.from({length: Math.min(5, rec.lines.length)}, (_, i) => i)));
  const mName = METHODS.find(m => m[0] === P.method)?.[1] || '기본';
  const mineNext = Tickets.all().filter(t => t.draw === sc.no).reduce((a, t) => a + t.lines.length, 0);
  $('main').innerHTML = `
    <section class="card hero">
      ${sc.pending ? `<div class="row" style="margin:0 0 6px;">${sc.live ? '<span class="live">LIVE 추첨 중</span>' : '<span class="pill wait">결과 집계 중</span>'}</div>
        <div class="k">${sc.no}회 추첨 끝 · 결과가 나오면 1분 안에 저절로 바뀝니다</div><button class="btn sm" id="chk" type="button" style="margin:8px 0 4px;">🔄 지금 확인</button>`
      : `<div class="k">${sc.no}회 추첨까지 · ${sc.t.getMonth() + 1}월 ${sc.t.getDate()}일(토) 20:35</div><div class="big" id="cd">${countdown(sc.t)}</div>`}
      <div class="row">
        <a class="btn gold sm" href="${LINKS.buy}" target="_blank" rel="noopener">🛒 구매</a>
        <a class="btn ghost sm" href="${LINKS.onair}" target="_blank" rel="noopener">📺 생방송</a>
        <a class="btn ghost sm" href="${LINKS.result}" target="_blank" rel="noopener">공식 결과</a>
        <a class="btn ghost sm" href="${LINKS.yt}" target="_blank" rel="noopener">지난 방송</a>
      </div>
      ${mineNext ? `<div class="k" style="margin-top:10px;">이번 회차 내 복권 ${mineNext}게임</div>` : ''}
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between;"><h2>${last.no}회 당첨번호</h2><span class="cap" style="margin:0;">${esc(last.date)}</span></div>
      <div class="balls" style="margin:8px 0;">${last.n.map(n => ball(n)).join('')}<span class="plus">+</span>${ball(last.b)}</div>
      <p class="cap" style="margin:0 0 8px;">1등 ${last.w1 != null ? fmt(last.w1) + '명' : '-'} · 1인당 ${won(last.p1)}</p>
      ${fold('등수별 당첨금·확률', prizeTable(last))}
      ${fold('인터넷으로 사는 법', `<ol class="steps"><li>🛒 구매 → 동행복권 로그인(처음이면 회원가입·본인인증)</li><li>마이페이지에서 <b>예치금 충전</b>(가상계좌·간편충전)</li><li>위 메뉴 <b>로또6/45 → 구매하기</b> → 자동·수동 고르기</li><li>산 뒤 마이페이지 구매내역의 QR(또는 번호)을 '내 복권'에 넣기</li></ol><p class="cap" style="margin:6px 0 0;">인터넷은 1인 1회차 5,000원(5게임)까지 · 토요일 20시에 판매 마감, 일요일 아침 6시에 다시 열림(시간은 동행복권 안내가 우선) · 휴대폰 화면이 깨지면 브라우저 메뉴의 'PC 버전'.</p>`)}
    </section>
    ${last.tmp ? `<section class="card"><h2>${sc.no}회 추천</h2><p class="cap" style="margin:6px 0 0;">결과를 방금 받아 와서, 이번 회차 고정 추천은 분석이 끝나면 나옵니다(보통 30분 안). 지금 만들면 나중에 번호가 바뀌어서 기다립니다.</p></section>` : `<section class="card">
      <div class="row" style="justify-content:space-between;"><h2>${sc.no}회 추천 ${rec.lines.length}줄</h2><button class="pill link" data-goto="settings" type="button">${esc(mName)}${v ? ` · ${v + 1}번째` : ''} ›</button></div>
      ${fold('어떻게 고른 번호인가요?', `이번 회차엔 고정이라 몇 번을 열어도 같습니다. 방식: ${esc(METHODS.find(m => m[0] === P.method)?.[2] || '')}. 역대 1등 조합은 빼고, 줄끼리 많이 겹치지 않게 골랐습니다. 방식은 설정에서 바꿉니다. 지난 회차에 이 방식을 썼다면 어땠는지는 분석 탭 '추천 방식 성적표'.`)}
      <div class="lines" id="recL">${rec.lines.map((s, i) => `<button type="button" class="ln pickable ${picked.has(i) ? 'on' : ''}" data-i="${i}"><span class="lab">${i + 1}</span><span class="balls">${s.map(n => ball(n, 'sm')).join('')}</span><span class="tick">${picked.has(i) ? '✓' : ''}</span></button>`).join('')}</div>
      <p class="cap" style="margin:10px 0 0;">살 줄을 눌러 고르세요 · ${picked.size}줄 ${fmt(picked.size * 1000)}원${picked.size > 5 ? ' · 인터넷 구매는 1주 5천 원까지' : ''}</p>
      <div class="row" style="margin-top:10px;"><a class="btn gold" href="${LINKS.buy}" target="_blank" rel="noopener">🛒 동행복권에서 사기</a><button class="btn ghost" id="keep" type="button" ${picked.size ? '' : 'disabled'}>내 복권에 담기</button></div>
    </section>`}`;
  $('chk') && ($('chk').onclick = async () => { $('chk').textContent = '확인 중…'; if(await load()){ show(view); toast(`${sc.no}회 결과가 나왔어요!`); } else { $('chk').textContent = '🔄 지금 확인'; toast('아직 안 나왔어요 · 보통 추첨 20~40분 뒤'); } });
  $('recL') && ($('recL').onclick = (e) => {
    const b = e.target.closest('[data-i]'); if(!b) return;
    const k = +b.dataset.i; picked.has(k) ? picked.delete(k) : picked.add(k);
    LS.set(pkey, [...picked]); renderHome();
  });
  $('keep') && ($('keep').onclick = () => {
    const ls = [...picked].sort((a, b) => a - b).map(k => rec.lines[k]);
    for(let i = 0; i < ls.length; i += 5) Tickets.add({draw: sc.no, lines: ls.slice(i, i + 5), kinds: Array(Math.min(5, ls.length - i)).fill('추천'), src: '추천'});   // 한 장 5줄씩
    toast(`${sc.no}회 ${ls.length}줄 담음 · 산 뒤 QR로 찍으면 더 정확해요`);
  });
  clearInterval(timer);
  if(!sc.pending) timer = setInterval(() => { if($('cd')) $('cd').textContent = countdown(sc.t); else clearInterval(timer); if(Date.now() >= sc.t.getTime()) renderHome(); }, 1000);
  // 추첨 뒤 결과가 들어오기 전엔 2분마다 다시 받아 본다
  clearInterval(poll);
  if(sc.pending) poll = setInterval(async () => { if(document.hidden) return; if(await load()){ show(view); toast(`${sc.no}회 결과가 나왔어요!`); } }, 60e3);
  // 결과를 임시로 붙인 상태면 우리 분석(추천 고정)이 올라올 때까지 2분마다 다시 받아 봄
  else if(last.tmp) poll = setInterval(async () => { if(document.hidden) return; await load(); if(!D[D.length - 1].tmp){ show(view); toast('이번 회차 추천이 나왔어요'); } }, 120e3);
}

// 등수별 당첨금·확률 (1~3등은 그 회차 판매액에서 나눠 가져 매주 바뀜 → 지난 회차 금액)
function prizeTable(d){
  const R = [[1, '6개 모두', '8,145,060', d.p1], [2, '5개 + 보너스', '1,357,510', d.p2], [3, '5개', '35,724', d.p3], [4, '4개', '733', 50000], [5, '3개', '45', 5000]];
  return `<table class="prize"><thead><tr><th>등수</th><th>맞힐 것</th><th class="n">확률</th><th class="n">당첨금</th></tr></thead><tbody>
    ${R.map(([r, c, o, p]) => `<tr><td><span class="rkb r${r}">${r}등</span></td><td>${c}</td><td class="n">1/${o}</td><td class="n"><b>${won(p)}</b></td></tr>`).join('')}</tbody></table>
    <p class="cap" style="margin:8px 0 0;">1~3등 = ${d.no}회 1인당 금액(판매액·당첨자 수에 따라 매주 다름) · 4등 5만 원·5등 5천 원은 고정 · 한 줄이 5등 이상일 확률 약 1/42.<br>세금: 200만 원 넘는 부분 22%, 3억 넘는 부분 33% · 받는 곳: 1등 농협은행 본점, 2·3등 농협은행 지점, 4·5등 판매점(인터넷 구매는 예치금으로) · 추첨일부터 1년 안에.</p>`;
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
  const segs = [['week', '📅 매주'], ['rank', '🏆 성적표'], ['nums', '🔢 번호'], ['pattern', '🧩 패턴']];
  const body = anaSeg === 'nums' ? anaNums() : anaSeg === 'pattern' ? anaPattern() : anaSeg === 'week' ? anaWeek() : anaRank();
  $('main').innerHTML = `<div class="seg" id="seg">${segs.map(([k, t]) => `<button type="button" data-s="${k}" class="${anaSeg === k ? 'on' : ''}">${t}</button>`).join('')}</div>${body}`;
  $('seg').onclick = (e) => { const b = e.target.closest('[data-s]'); if(b){ anaSeg = b.dataset.s; LS.set('anaSeg', anaSeg); renderAnalysis(); } };
  const ss = $('nSort'); if(ss){ ss.value = LS.get('nSort', 'freq'); ss.onchange = () => { LS.set('nSort', ss.value); renderAnalysis(); }; }
}
// 추천 방식 성적표 — '매주 10줄씩 샀다면 얼마 쓰고 얼마 받았나'를 방식마다 카드 한 장으로 (한눈에 비교)
function recReport(){
  const BT = A.rec_bt; if(!BT) return '';
  const P = Pref.get(), W = BT.methods[0].draws, M = [...BT.methods].sort((a, b) => b.roi - a.roi);
  const man = (n) => { n = Math.round(n); return n >= 1e8 ? fmt(n / 1e8, 1) + '억' : fmt(Math.round(n / 1e4)) + '만'; };
  const nm = (k) => METHODS.find(x => x[0] === k)?.[1] || k;
  // 무작위 한 줄 기대 — 5등 22.44‰×5천 + 4등 1.365‰×5만 = 180원(18.0%). 3등↑은 드물어(1,149회×10줄에 0.3번) 빼고 비교
  const BASE = 18.0, mx = Math.max(40, ...M.map(m => m.roi)) * 1.05;
  const no3 = (m) => (m.rank[4] * 5000 + m.rank[3] * 50000) / m.spent * 100;
  const lo = Math.min(...M.map(no3)), hi = Math.max(...M.map(no3));
  const lucky = M[0].rank[0] + M[0].rank[1] + M[0].rank[2] > 0;
  const recent = BT.recent[P.method] || [];
  const rk = (m) => m >= 6 ? '1등' : m === 5 ? '3등↑' : m === 4 ? '4등' : m === 3 ? '5등' : '';
  const cards = M.map((m, i) => {
    const big = (m.hits || []).filter(h => h[1] <= 3), h4 = (m.hits || []).filter(h => h[1] === 4);
    return `<div class="mcard ${m.key === P.method ? 'mine' : ''}">
      <div class="mh"><span class="rk">${i + 1}</span><b>${esc(nm(m.key))}</b>${m.key === P.method ? '<span class="pill now">지금 방식</span>' : ''}<span class="roi">${fmt(m.roi, 1)}<small>%</small></span></div>
      <div class="mbar" aria-label="회수율 ${fmt(m.roi, 1)}%"><i style="width:${(m.roi / mx * 100).toFixed(1)}%"></i><s style="left:${(BASE / mx * 100).toFixed(1)}%"></s></div>
      <div class="mm"><span>낸 돈<b>${man(m.spent)}원</b></span><span>받은 돈<b>${man(m.won)}원</b></span><span class="loss">손해<b>−${man(m.spent - m.won)}원</b></span></div>
      <div class="mchips">${[[3, m.rank[0] + m.rank[1] + m.rank[2], '3등↑'], [4, m.rank[3], '4등'], [5, m.rank[4], '5등']].map(([r, c, t]) => `<span class="rkb r${r} ${c ? '' : 'zero'}">${t} ${fmt(c)}번</span>`).join('')}</div>
      ${m.key === 'mine' && A.mine_crowd ? `<p class="mnote">👥 1등이면 나눌 사람 <b>${fmt(A.mine_crowd.yes.ratio, 2)}배</b> (실제 ${fmt(A.mine_crowd.yes.draws)}회, 나머지 모양은 ${fmt(A.mine_crowd.no.ratio, 2)}배) — 맞힐 확률은 같고 1등 금액이 그만큼 큼</p>` : ''}
      ${big.length ? `<p class="mnote">⭐ ${big.map(h => `${h[0]}회 ${h[1]}등 ${won(h[2])}`).join(', ')} — 이 한 번을 빼면 ${fmt(no3(m), 1)}%</p>` : ''}
      ${h4.length ? `<details class="fold mini"><summary>4등 맞은 회차 ${h4.length}번</summary><div class="fold-b">${h4.map(h => `<span class="hitc">${h[0]}회</span>`).join('')}</div></details>` : ''}
    </div>`;
  }).join('');
  return `<section class="card"><h2>추천 방식 성적표</h2>
      <p class="cap">${fmt(BT.from)}회부터 ${fmt(W)}주 동안 <b>매주 10줄(1만 원)</b>씩, 그 회차 <b>전까지 쌓인 기록 전부</b>로 골라 샀다면(그 뒤 결과는 안 봄)</p>
      <div class="verdict"><b>${lucky ? `1위 '${esc(nm(M[0].key))}'는 3등 한 번 덕분` : '어느 방식도 앞서지 않습니다'}</b>
        <span>4·5등만 보면 ${M.length}가지 방식 모두 ${fmt(lo, 1)}~${fmt(hi, 1)}% — 무작위로 샀을 때 보통(${fmt(BASE, 0)}%)과 같은 범위. 1만 원을 내면 ${fmt(Math.round(lo) * 100)}~${fmt(Math.round(hi) * 100)}원쯤 돌아옵니다.</span></div>
      <div class="legend"><span><i class="lg-bar"></i>받은 돈 ÷ 낸 돈</span><span><i class="lg-mark"></i>무작위 보통 18%</span></div>
      <div class="mcards">${cards}</div>
      ${fold('결과 읽는 법', `${fmt(W)}주×10줄 = ${fmt(BT.methods[0].lines)}줄. 무작위로 사도 5등은 약 ${fmt(BT.methods[0].lines * 0.0224384)}번(± ${fmt(Math.sqrt(BT.methods[0].lines * 0.0224384) * 2)}), 4등은 약 ${fmt(BT.methods[0].lines * 0.0013649, 1)}번(± ${fmt(Math.sqrt(BT.methods[0].lines * 0.0013649) * 2, 1)})은 운으로 오르내립니다. 모든 방식이 이 범위 안이라 어느 방식도 확률이 더 높지 않습니다. 3등(150만 원 안팎) 한 번이 회수율을 10%p 넘게 올리므로, 위 순위는 실력보다 운입니다. 1·2등은 한 번도 없었고 이론상 기대도 0.0014번입니다.`)}
      <h3>지금 방식(${esc(nm(P.method))}) 최근 30회</h3>
      <div class="recent">${recent.slice().reverse().map(([no, m]) => `<span class="rc m${Math.min(m, 5)}" title="${no}회 가장 많이 맞은 줄 ${m}개"><b>${m}</b><small>${no}</small>${rk(m) ? `<i>${rk(m)}</i>` : ''}</span>`).join('')}</div>
      <p class="cap" style="margin:8px 0 0;">숫자 = 그 회차 10줄 중 가장 많이 맞은 개수</p></section>`;
}
// 매주 성적: 지난 회차마다 각 방식이 추천했을 10줄(같은 규칙·같은 씨앗 = 그 주 앱에 떴을 번호)을 실제 결과와 맞춰 봄.
// rec_log.json(추첨 전에 얼려 둔 추천)이 있는 회차는 '기록', 없으면 '재현'
let RLOG = {};
function anaWeek(){
  const W = A.rec_bt?.weeks || {}, P = Pref.get();
  const nm = (k) => METHODS.find(x => x[0] === k)?.[1] || k;
  const keys = METHODS.map(m => m[0]);
  const nos = [...new Set([...Object.keys(W), ...Object.keys(RLOG)].map(Number))].sort((a, b) => b - a);
  const last = D[D.length - 1].no;
  const weeks = nos.filter(no => no <= last).map(no => ({no, d: D[no - 1], rec: RLOG[no]?.m || W[no], real: !!RLOG[no]})).filter(w => w.rec && w.d);
  const next = nos.find(no => no > last && RLOG[no]);
  const tot = {};
  weeks.forEach(w => keys.forEach(k => (w.rec[k] || []).forEach(l => { const j = judge(l, w.d), t = tot[k] = tot[k] || {r: [0, 0, 0, 0, 0, 0], won: 0, n: 0}; t.n++; t.r[j.rank]++; t.won += j.prize; })));
  const order = keys.filter(k => tot[k]).sort((a, b) => tot[b].won - tot[a].won);
  const nW = weeks.length;
  const sum = `<section class="card"><h2>최근 ${nW}주 합계</h2><p class="cap">방식마다 매주 추천 10줄(1만 원)씩 샀다면 · 낸 돈 ${fmt(nW)}만 원</p>
    <table><thead><tr><th>방식</th><th class="n">5등</th><th class="n">4등</th><th class="n">3등↑</th><th class="n">받은 돈</th></tr></thead><tbody>
    ${order.map((k, i) => { const t = tot[k]; return `<tr class="${k === P.method ? 'meta' : ''}"><td><span class="rk">${i + 1}</span>${esc(nm(k))}</td><td class="n">${t.r[5]}</td><td class="n">${t.r[4]}</td><td class="n">${t.r[1] + t.r[2] + t.r[3]}</td><td class="n"><b>${fmt(t.won / 1e4, t.won % 1e4 ? 1 : 0)}만</b></td></tr>`; }).join('')}</tbody></table>
    ${fold('이 표 보는 법', `몇 주로는 운이 전부입니다. 무작위로 사도 10줄이면 한 주에 5등 0.22번·4등 0.014번이 기대값이라, ${nW}주면 5등 ${fmt(nW * 0.224, 1)}번 안팎이 보통입니다. 순위가 매주 뒤바뀌는 게 정상이고, 한 방식이 계속 앞서는지 오래 보는 용도입니다. '재현' = 그 주 앱이 보여 줬을 번호를 같은 규칙으로 다시 만든 것, '기록' = 추첨 전에 저장해 둔 추천(${Object.keys(RLOG).length ? '이번 달부터 쌓는 중' : '다음 추첨부터 쌓임'}).`)}</section>`;
  const nextCard = next ? `<section class="card"><div class="row" style="justify-content:space-between;"><h2>${next}회 추천 얼려 둠</h2><span class="pill wait">추첨 후 채점</span></div><p class="cap" style="margin:4px 0 0;">${esc(String(RLOG[next].at || '').slice(0, 16).replace('T', ' '))}에 저장 · 추첨이 끝나면 여기서 바로 맞춰 봅니다</p></section>` : '';
  const cards = weeks.map(w => {
    const rows = order.map(k => {
      const L = w.rec[k] || [], J = L.map(l => judge(l, w.d)), won = J.reduce((a, j) => a + j.prize, 0), best = Math.max(0, ...J.map(j => j.m));
      const hits = [1, 2, 3, 4, 5].map(r => [r, J.filter(j => j.rank === r).length]).filter(x => x[1]);
      return `<details class="wk ${k === P.method ? 'mine' : ''}"><summary><b>${esc(nm(k))}</b><span class="wh">${hits.length ? hits.map(([r, c]) => `<span class="rkb r${r}">${r}등${c > 1 ? '×' + c : ''}</span>`).join('') : `<span class="cap" style="margin:0;">최고 ${best}개</span>`}</span><span class="ww">${won ? fmt(won) + '원' : '0원'}</span></summary>
        <div class="lines" style="margin-top:8px;">${L.map((s, i) => { const j = J[i]; return `<div class="ln"><span class="lab">${i + 1}</span><span class="balls">${s.map(n => ball(n, 'sm' + (!w.d.n.includes(n) && !(j.rank === 2 && n === w.d.b) ? ' off' : ''))).join('')}</span><span class="res ${j.rank ? 'win' : 'miss'}">${j.rank ? j.rank + '등' : j.m + '개'}</span></div>`; }).join('')}</div></details>`;
    }).join('');
    return `<section class="card"><div class="row" style="justify-content:space-between;"><h2>${w.no}회</h2><span class="pill ${w.real ? 'now' : ''}">${w.real ? '기록' : '재현'} · ${esc(w.d.date.slice(5).replace('-', '/'))}</span></div>
      <div class="balls" style="margin:8px 0 10px;">${w.d.n.map(n => ball(n, 'sm')).join('')}<span class="plus">+</span>${ball(w.d.b, 'sm')}</div>${rows}</section>`;
  }).join('');
  return nextCard + sum + cards;
}
function anaRank(){
  const B = A.backtest, R = [...B.methods].sort((a, b) => b.ge3 - a.ge3 || b.mean - a.mean);
  const lo = B.theory_ge3 - 1.96 * B.ge3_se, hi = B.theory_ge3 + 1.96 * B.ge3_se;
  const beat = R.filter(m => m.ge3 > hi);
  const E = A.elim || [];
  return recReport() + `<div class="note"><b>${beat.length ? '무작위보다 확실히 나은 방법이 있습니다' : '1위 방법도 무작위와 구별되지 않습니다'}</b>
      ${fold('자세히', `승률 = 5등 이상(3개↑) 맞은 비율. 무작위 이론값 ${fmt(B.theory_ge3, 2)}%, 운으로 나오는 범위 ${fmt(lo, 2)}~${fmt(hi, 2)}%. 모든 방법이 이 안에 있습니다. '그때그때 승률 1위 방법 따라가기'도 표본외로 시험했지만 같은 범위입니다.`)}</div>
    ${A.how1?.draws ? (() => { const h = A.how1, t = h.auto + h.semi + h.manual; return `<section class="card"><h2>분석해서 산 사람이 더 잘 맞나?</h2><p class="cap">1등 당첨자가 번호를 고른 방식 · ${fmt(h.from)}회부터 ${fmt(h.draws)}회, ${fmt(t)}명</p>
      <div class="split"><div><b>${fmt(h.auto / t * 100, 1)}%</b><span>자동</span></div><div><b>${fmt(h.manual / t * 100, 1)}%</b><span>수동(직접 고름)</span></div><div><b>${fmt(h.semi / t * 100, 1)}%</b><span>반자동</span></div></div>
      ${fold('어떻게 봐야 하나요?', '수동으로 산 사람이 1등의 약 3분의 1입니다. 수동이 더 잘 맞는지는 판매 중 수동 비율과 비교해야 하는데, 그 비율은 이 데이터에 없어 맞대어 보지 못했습니다(판매도 30% 안팎이 수동이면 차이 없음). 분석 사이트·유튜브의 "적중" 사례는 맞은 것만 골라 보여 주는 경우가 많아, 더 잘 맞아 보이는 착시가 생깁니다.')}</section>`; })() : ''}
    ${E.length ? `<section class="card"><h2>안 나올 것 같은 조합을 지우면?</h2><p class="cap">지운 조합 비율 = 실제 당첨번호가 그 안에 있던 비율 → 남은 조합의 확률이 오르지 않음</p>
      <table><thead><tr><th>지우는 패턴</th><th class="n">지운 조합</th><th class="n">실제 당첨</th></tr></thead>
      <tbody>${E.map(e => `<tr><td>${esc(e.name)}</td><td class="n">${fmt(e.combo_pct, 2)}%</td><td class="n"><b>${fmt(e.win_pct, 2)}%</b></td></tr>`).join('')}</tbody></table>
      ${fold('왜 그런가요?', `1·3·5·7·9·11 같은 줄은 '그 모양이 드문' 게 아니라 그 모양에 속한 조합 수가 적을 뿐입니다. 한 줄 한 줄의 확률은 모두 1/8,145,060로 같습니다. 그래서 어떤 모양을 지우면 그만큼 당첨번호도 그 안에 있었고(위 두 칸이 같음), 내가 산 한 줄의 확률은 그대로입니다. 지워서 얻는 건 확률이 아니라, 사람들이 많이 고르는 모양(연속·등차·생일)을 피해 당첨금을 덜 나누는 것뿐입니다.`)}</section>` : ''}
    <section class="card"><h2>분석법 승률 순위</h2><p class="cap">${fmt(B.from)}회부터 매 회, 그 회차 전까지 쌓인 기록 전부로 골랐다면 · ${fmt(R[0].draws)}회</p>
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
      <select id="nSort" style="font:inherit; padding:6px 10px; border-radius:10px; border:1.5px solid var(--line); background:var(--card); color:var(--text);"><option value="freq">전체 많이 나온 순</option><option value="r50">최근 50회 많이</option><option value="r10">최근 10회 많이</option><option value="gap">오래 안 나온 순</option><option value="no">번호 순</option></select></div>
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
function renderSettings(){
  const P = Pref.get(), sc = schedule(), v = LS.get('var' + sc.no, 0), BT = A.rec_bt;
  const bt = (k) => BT?.methods.find(m => m.key === k);
  $('main').innerHTML = `<section class="card"><h2>추천 방식</h2><p class="cap">홈의 추천 번호를 어떤 방식으로 고를지. 지난 ${BT ? fmt(BT.methods[0].draws) : '-'}회에 10줄씩 썼다면의 성적도 같이</p>
      <div class="opts">${METHODS.map(([k, t, d]) => { const b = bt(k); return `<button type="button" class="optc ${P.method === k ? 'on' : ''}" data-m="${k}"><span class="r"></span><span class="t"><b>${esc(t)}</b><small>${esc(d)}</small>${b ? `<small class="bt">5등 ${fmt(b.rank[4])} · 4등 ${fmt(b.rank[3])}${b.rank[2] ? ` · 3등 ${b.rank[2]}` : ''} · 회수율 ${fmt(b.roi, 1)}%</small>` : ''}</span></button>`; }).join('')}</div>
      ${fold('어느 방식이 제일 좋나요?', `맞힐 확률은 어느 방식이든 같습니다(분석 탭 성적표 — 4·5등이 모두 무작위 범위). 실제로 차이가 나는 건 1등이 됐을 때 나눌 사람 수뿐이라, 그걸 줄이는 <b>나만의 방식</b>을 기본으로 둡니다.${A.mine_crowd ? ` 실제 당첨번호가 이 모양이었던 ${fmt(A.mine_crowd.yes.draws)}회는 1등이 기대의 ${fmt(A.mine_crowd.yes.ratio, 2)}배(±${fmt(A.mine_crowd.yes.ci, 2)})만 나왔고 나머지는 ${fmt(A.mine_crowd.no.ratio, 2)}배.` : ''} '지난 성적 1위 방식 따라가기'도 시험했지만 무작위와 구별되지 않아 넣지 않았습니다.`)}</section>
    <section class="card"><h2>줄 수</h2><div class="seg" style="margin:8px 0 0;">${[5, 10].map(n => `<button type="button" data-n="${n}" class="${P.lines === n ? 'on' : ''}">${n}줄</button>`).join('')}</div></section>
    <section class="card"><h2>새 추천 받기</h2><p class="cap">같은 방식으로 ${sc.no}회 번호를 다시 뽑습니다. 지금 ${v + 1}번째 추천</p>
      <div class="row"><button class="btn" id="newRec" type="button">🎲 새 추천 받기</button>${v ? '<button class="btn ghost" id="resetRec" type="button">처음 추천으로</button>' : ''}</div></section>
    <section class="card"><h2>👫 같이 보기</h2><div id="shareBox">${shareBox()}</div></section>
    <section class="card"><h2>앱 정보</h2><p class="cap" style="margin:0;">당첨번호 ${fmt(D[D.length - 1].no)}회까지 · 분석 갱신 ${esc(A.updated_at.slice(0, 16).replace('T', ' '))} · ${VER}<br>${Cloud.rid ? '내 복권·설정은 같이 보기 공간에 저장됩니다.' : '로그인 전에는 이 폰에만 저장됩니다.'}</p>
      ${fold('앱으로 설치가 안 될 때', '크롬: 오른쪽 위 ⋮ → <b>앱 설치</b>(또는 홈 화면에 추가 → 설치). \'바로가기 만들기\'만 나오거나 \'이미 설치됨\'이면 홈 화면의 옛 로또 노트 아이콘을 길게 눌러 삭제한 뒤 이 페이지를 새로 고침하고 다시 하세요. 아이폰: 사파리 공유 → 홈 화면에 추가.')}</section>`;
  $('main').querySelectorAll('[data-m]').forEach(b => b.onclick = () => { Pref.set({method: b.dataset.m}); renderSettings(); toast('추천 방식을 바꿨습니다'); });
  $('main').querySelectorAll('[data-n]').forEach(b => b.onclick = () => { Pref.set({lines: +b.dataset.n}); renderSettings(); });
  $('newRec').onclick = () => { LS.set('var' + sc.no, v + 1); toast('새 추천을 받았습니다'); show('home'); };
  $('resetRec') && ($('resetRec').onclick = () => { LS.set('var' + sc.no, 0); renderSettings(); });
  Cloud.init().catch(() => {});   // 로그인 팝업이 막히지 않게 미리 불러 둠
}
document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if(g){ e.preventDefault(); show(g.dataset.goto); } });
const VIEWS = {home: renderHome, tickets: renderTickets, analysis: renderAnalysis, settings: renderSettings};
function show(v){
  view = VIEWS[v] ? v : 'home'; LS.set('view', view);
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  if(!A){ $('main').innerHTML = '<div class="empty">데이터를 불러오지 못했습니다. 연결을 확인하세요.</div>'; return; }
  VIEWS[view]();
  window.scrollTo(0, 0);
}
$('tabbar').onclick = (e) => { const b = e.target.closest('[data-v]'); if(b) show(b.dataset.v); };
const ORDER = ['home', 'tickets', 'analysis', 'settings'];
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
// 추첨 뒤엔 우리 데이터(매주 Actions → Pages, 늦으면 30분↑)를 기다리지 않고 공개 JSON(smok95/lotto, CORS 허용)에서 바로 받아 임시로 붙인다(tmp)
async function liveResult(){
  const no = D[D.length - 1].no + 1;
  try{
    const r = await fetch(`https://raw.githubusercontent.com/smok95/lotto/main/results/${no}.json?t=${Date.now()}`, {cache: 'no-store'});
    if(!r.ok) return false;
    const d = await r.json(), dv = d.divisions || [];
    if(+d.draw_no !== no || !Array.isArray(d.numbers) || d.numbers.length !== 6) return false;
    D.push({no, date: String(d.date).slice(0, 10), n: d.numbers.map(Number).sort((a, b) => a - b), b: +d.bonus_no,
      w1: dv[0]?.winners, p1: dv[0]?.prize, p2: dv[1]?.prize, p3: dv[2]?.prize, sales: d.total_sales_amount, tmp: 1});
    return true;
  }catch(e){ return false; }
}
async function load(){
  try{
    const [d, a] = await Promise.all(['data/draws.json', 'data/analysis.json'].map(u => fetch(u, {cache: 'no-cache'}).then(r => { if(!r.ok) throw new Error(u); return r.json(); })));
    const prevLast = D.length ? D[D.length - 1].no : 0;
    try{ const r = await fetch('data/rec_log.json', {cache: 'no-cache'}); if(r.ok) RLOG = await r.json(); }catch(e){}
    D = d; A = a;
    if(schedule().pending) await liveResult();
    const grew = D[D.length - 1].no > prevLast;
    $('dataInfo').textContent = `${fmt(D[D.length - 1].no)}회까지`; Cloud.paint();
    paintBadge();
    return grew;
  }catch(e){ return false; }
}
// 버전 표시 + 새 버전 알림: sw.js 의 VERSION 을 새로 받아 앱의 VER 과 다르면 위에 '업데이트' 띠 (열 때·다시 볼 때·10분마다)
$('ver').textContent = 'v' + VER;
async function checkUpdate(){
  try{
    const t = await (await fetch('sw.js?t=' + Date.now(), {cache: 'no-store'})).text();
    const v = (/VERSION\s*=\s*'([^']+)'/.exec(t) || [])[1];
    if(v && v !== VER){ $('updTxt').textContent = `새 버전 v${v} 이 나왔어요`; $('upd').hidden = false; document.body.classList.add('has-upd'); }
  }catch(e){}
}
$('updBtn').onclick = async () => {
  $('updBtn').textContent = '받는 중…';
  try{ const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); }catch(e){}
  try{ for(const k of await caches.keys()) await caches.delete(k); }catch(e){}
  location.reload();
};
document.addEventListener('visibilitychange', async () => { if(document.hidden) return; checkUpdate(); if(D.length && schedule().pending && await load()) show(view); });
setInterval(checkUpdate, 600e3);
(async () => { await load(); show(view); checkUpdate(); if(LS.get('cloud', false)) Cloud.init().catch(() => {}); })();
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
