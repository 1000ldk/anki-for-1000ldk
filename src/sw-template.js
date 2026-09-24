/* ビルド時に vite.config.ts が値を埋め込んで dist/sw.js として出力する */
const CACHE_NAME = __CACHE_NAME__;
const PRECACHE = __PRECACHE__;

const toUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE.map((p) => new Request(toUrl(p), { cache: 'reload' })))),
  );
  // 新バージョンはアプリ側で「反映する」を押すまで待機させる
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('anki-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // 画面遷移はハッシュで行うので、ページ本体は常にキャッシュ済みの index.html を返す
    event.respondWith(caches.match(toUrl('./'), { cacheName: CACHE_NAME }).then((res) => res || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE_NAME, ignoreSearch: true }).then((res) => res || fetch(req)));
});
