/* Ribi Onset — service worker
 *
 * 갱신 전략
 *  - 앱 코드(SHELL) : 네트워크 우선. 온라인이면 항상 최신을 받고, 실패하면 캐시로 폴백.
 *    (캐시 우선이면 배포 후 첫 새로고침에 늘 구버전이 떠서 "변화가 없다"가 된다)
 *  - 대용량 자산(vendor/, OCR 엔진) : 캐시 우선 + 영구 보관.
 *    코드 한 줄 고칠 때마다 7MB 를 다시 받지 않도록 SHELL 캐시와 분리한다.
 *
 * 코드를 수정하면 SHELL_VER 를 올린다.
 * 데이터는 IndexedDB 에 있으므로 캐시와 무관하다.
 */
const SHELL_VER   = 'ribi-onset-v11';
const ASSET_CACHE = 'ribi-onset-assets';
const NET_TIMEOUT = 4000;   // 이 시간 안에 응답 없으면 캐시로

const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/views.js',
  './js/schema.js',
  './js/media.js',
  './js/export.js',
  './js/ocr.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

const isAsset = (url) => url.pathname.includes('/vendor/');

self.addEventListener('install', (e) => {
  // 새 버전은 곧바로 대기 상태를 건너뛴다
  e.waitUntil(
    caches.open(SHELL_VER)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache:'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_VER && k !== ASSET_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'VERSION'){
    e.source && e.source.postMessage({ type:'VERSION', version: SHELL_VER });
  }
});

async function networkFirst(req){
  const cache = await caches.open(SHELL_VER);
  try {
    const net = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NET_TIMEOUT)),
    ]);
    if (net && net.status === 200) cache.put(req, net.clone());
    return net;
  } catch {
    const hit = await cache.match(req) || await caches.match(req);
    if (hit) return hit;
    throw new Error('offline & not cached: ' + req.url);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // OCR 엔진 등 대용량 자산 — 캐시 우선, 없으면 받아서 영구 보관
  if (isAsset(url)){
    e.respondWith(caches.open(ASSET_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.status === 200) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // 앱 코드 — 네트워크 우선
  e.respondWith(networkFirst(req));
});
