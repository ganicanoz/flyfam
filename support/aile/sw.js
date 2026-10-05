// Aile planı — çevrimdışı açılış. Sayfa önce ağdan (güncel sürüm), ağ yoksa önbellekten.
// Plan verisi (POST API) burada tutulmaz; sayfa kendi cihaz önbelleğini kullanır.
const CACHE = 'aile-shell-v6';
const SHELL = '/aile/';
const ASSETS = [SHELL, '/aile/manifest.webmanifest', '/aile/icon-180.png', '/aile/icon-192.png', '/aile/icon-512.png', '/aile/icon-maskable-512.png'];
const NET_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('aile-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/aile/')) return;

  const isPage = req.mode === 'navigate' || url.pathname === SHELL || url.pathname === '/aile/index.html';
  if (isPage) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await withTimeout(fetch(req, { cache: 'no-store' }), NET_TIMEOUT_MS);
        if (res && res.ok) cache.put(SHELL, res.clone());
        return res;
      } catch (_) {
        return (await cache.match(SHELL)) || Response.error();
      }
    })());
    return;
  }

  const net = caches.open(CACHE).then((cache) => fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })).catch(() => null);
  event.waitUntil(net);
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    return hit || (await net) || Response.error();
  })());
});

// Bildirimler: sunucu (family-planner) şifreli { title, body, url, tag } gönderir.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Aile planı', {
    body: d.body || '',
    icon: '/aile/icon-192.png',
    badge: '/aile/icon-192.png',
    tag: d.tag || 'aile',
    renotify: true,
    data: { url: d.url || SHELL },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || SHELL, self.location.origin);
  if (target.origin !== self.location.origin || !target.pathname.startsWith('/aile/')) target.href = new URL(SHELL, self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).pathname.startsWith('/aile/'));
    if (win) {
      await win.focus();
      win.postMessage({ type: 'open', url: target.pathname + target.search });
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
