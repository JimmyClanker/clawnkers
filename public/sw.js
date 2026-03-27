// Clawnkers Service Worker — offline landing page cache
// Update version to force cache refresh on deploy
const CACHE_NAME = 'clawnkers-v2-2026-03';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/logo.svg',
  '/favicon.ico',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Only cache GET requests for HTML pages
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Only intercept same-origin navigation requests
  if (url.origin !== location.origin) return;
  if (!event.request.headers.get('accept')?.includes('text/html')) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        // Cache successful HTML responses
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/')))
  );
});
