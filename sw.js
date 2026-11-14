// 네트워크 우선(오프라인이면 캐시). 앱 파일을 바꾸면 VERSION 을 올린다
const VERSION = '1.8.0';
const CACHE = 'lotto-' + VERSION;
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // cache:'no-cache' = 브라우저 보관본(GitHub Pages 10분)도 서버에 바뀌었는지 물어봄 → 올리면 바로 반영 (안 바뀌었으면 304라 가벼움)
  e.respondWith(fetch(e.request, {cache: 'no-cache'}).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
