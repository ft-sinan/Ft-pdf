/* Only public assets are cached. Private API responses and document bytes are never cached for offline browsing. */
const STATIC = 'ft-public-v1';
self.addEventListener('install', (event) =>
  event.waitUntil(
    caches
      .open(STATIC)
      .then((c) => c.addAll(['/offline.html', '/brand.svg', '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys())
        if (k.startsWith('ft-public-') && k !== STATIC) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === 'POST' && url.pathname === '/share-inbox') {
    event.respondWith(
      (async () => {
        const f = await req.formData(),
          cache = await caches.open('ft-share-inbox');
        for (const key of await cache.keys()) await cache.delete(key);
        let total = 0;
        for (const entry of f.getAll('files')) {
          if (!(entry instanceof File) || !entry.name || entry.size > 25 * 1024 * 1024) continue;
          total += entry.size;
          if (total > 100 * 1024 * 1024) break;
          await cache.put(
            '/shared-file/' + crypto.randomUUID(),
            new Response(entry, {
              headers: {
                'Content-Type': entry.type || 'application/octet-stream',
                'x-ft-name': encodeURIComponent(entry.name),
              },
            }),
          );
        }
        return Response.redirect(new URL('/?shared=1', url), 303);
      })(),
    );
    return;
  }
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  if (url.pathname.startsWith('/assets/'))
    event.respondWith(
      (async () => {
        const c = await caches.open(STATIC),
          hit = await c.match(req);
        if (hit) return hit;
        const r = await fetch(req);
        if (r.ok) await c.put(req, r.clone());
        return r;
      })(),
    );
});
