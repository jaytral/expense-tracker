const CACHE_NAME = 'rupeeledger-pwa-v1.2.0';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL_ASSETS);
      for (const url of CDN_ASSETS) {
        try {
          const request = new Request(url, { mode: 'cors' });
          const response = await fetch(request);
          if (response && (response.status === 200 || response.type === 'opaque')) {
            await cache.put(url, response);
          }
        } catch (_err) {
          // Ignore transient CDN failure during install; runtime caching will catch it
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Navigation requests: serve cached index.html if offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return networkResponse;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('./index.html');
          if (cachedIndex) return cachedIndex;
          return caches.match('./');
        })
    );
    return;
  }

  // Same-origin app shell & assets: Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkFetch;
      })
    );
    return;
  }

  // Cross-origin CDN assets (Tailwind, Lucide, Google Fonts): Cache-First with network fallback
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Refresh in background
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => new Response('', { status: 503, statusText: 'Offline' }));
    })
  );
});
