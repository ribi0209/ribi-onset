/* Ribi Onset — service worker
 *
 * 캐시를 둘로 나눈다.
 *  - SHELL_CACHE : 앱 코드. 버전을 올리면 통째로 새로 받는다.
 *  - ASSET_CACHE : OCR 엔진처럼 크고 잘 안 바뀌는 파일. 버전을 올려도 유지한다.
 *    (안 그러면 코드 한 줄 고칠 때마다 태블릿이 7MB 를 다시 받게 된다)
 *
 * 코드를 수정한 뒤에는 SHELL_VER 만 올리면 된다.
 * 데이터는 IndexedDB 에 있으므로 캐시와 무관하다.
 */
const SHELL_VER   = 'ribi-onset-v3';
const ASSET_CACHE = 'ribi-onset-assets';

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

/** 용량이 큰 런타임 자산 (첫 사용 시 받아서 계속 보관) */
const isAsset = (url) => url.pathname.includes('/vendor/');

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // OCR 엔진 등 대용량 자산 — 캐시 우선, 없으면 받아서 영구 보관
  if (isAsset(url)){
    e.respondWith(
      caches.open(ASSET_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.status === 200) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // 앱 코드 — 캐시 우선 + 백그라운드 갱신
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) caches.open(SHELL_VER).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
