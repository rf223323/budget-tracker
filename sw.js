const CACHE_NAME = 'budget-tracker-v9';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)).catch(()=>{})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page itself (HTML) is network-first, so a deployed update shows on the
// very next load instead of one visit later; the cached copy is only the
// offline fallback. Everything else is stale-while-revalidate (instant, works
// offline, refreshed in the background). Same-origin revalidation bypasses the
// browser's own HTTP cache, which would otherwise hand the worker a stale copy.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isPage = event.request.mode === 'navigate' || (sameOrigin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')));
  const fresh = () => sameOrigin ? fetch(url.href, { cache: 'no-cache' }) : fetch(event.request);

  if (isPage) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        try {
          const response = await fresh();
          if (response && response.status === 200) cache.put('./index.html', response.clone());
          return response;
        } catch (e) {
          return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);
      const networkFetch = fresh()
        .then(response => {
          if (response && (response.status === 200 || response.type === 'opaque')) {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// ---- Push reminders (sent by the scheduled job in .github/workflows/reminders.yml) ----
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {body: event.data && event.data.text()}; }
  event.waitUntil(self.registration.showNotification(data.title || 'Embalance', {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'favicon.png',
    tag: data.tag || 'embalance-reminder',
    renotify: true,
    data: {url: data.url || './index.html'}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
