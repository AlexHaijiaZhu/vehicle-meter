const CACHE = 'vehicle-meter-v1';

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/css/app.css',
  '/css/notion.css',
  '/js/app.js',
  '/js/api.js',
  '/js/store.js',
  '/js/ui.js',
  '/js/icons.js',
  '/js/charts.js',
  '/js/constants.js',
  '/js/modals.js',
  '/js/sharecard.js',
  '/js/pwa.js',
  '/js/pages/dashboard.js',
  '/js/pages/expenses.js',
  '/js/pages/energy.js',
  '/js/pages/maintenance.js',
  '/js/pages/reports.js',
  '/js/pages/vehicles.js',
  '/js/pages/settings.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        ASSETS.map(async (asset) => {
          try {
            await cache.add(asset);
          } catch (err) {
            console.warn('[sw] skipped precache', asset, err.message);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE && key.startsWith('vehicle-meter-')).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request, cacheKey = request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(cacheKey, response.clone());
    return response;
  } catch {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    const fallback = await caches.match('/index.html');
    if (fallback) return fallback;
    return new Response('车记暂时离线，请恢复网络后重试。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  const extension = url.pathname.split('.').pop()?.toLowerCase();
  if (['js', 'mjs', 'css', 'html', 'webmanifest', 'json'].includes(extension)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'ico', 'woff2'].includes(extension)) {
    event.respondWith(cacheFirst(request));
  }
});
