/*
 * HisabPay service worker — the app shell, cached so the shop opens without a connection.
 *
 * WHY THIS EXISTS
 *   `src/main.tsx` registers `/sw.js` in every production web build. It used to cache only
 *   `/assets/`, deliberately: a cached `index.html` can pin an owner to yesterday's JavaScript.
 *   That is still true right up to the moment the connection drops, when the choice is a stale
 *   shell or no app at all. The owner's requirement is that the app keeps working offline
 *   (2026-11-19), so the shell is cached, but the network always wins when it answers.
 *
 * THE THREE POLICIES
 *   1. Navigations: network first. A 200 from the network is stored as the new shell and served;
 *      if the network fails (offline, DNS, timeout) the last stored shell answers instead. A new
 *      deploy therefore replaces the shell the next time the app opens online.
 *   2. Hashed build output under `/assets/`: cache first. Every filename carries a content hash,
 *      so a cached copy can never be a stale copy of something else.
 *   3. Everything else (Supabase, fonts, cross-origin) is untouched. Those responses are
 *      per-user and must never be replayed from a shared cache.
 *
 * Data itself does not live here: the stores keep their own per-account cache in localStorage,
 * which is what the screens read while the network is unavailable.
 */

const SHELL_CACHE = 'agrishop-shell-v1';
const ASSET_CACHE = 'agrishop-assets-v1';
const SHELL_URLS = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png', '/favicon.png'];
const IMMUTABLE_PREFIX = '/assets/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One failed file must not abort the install; the navigation fallback is the only one that
      // really matters, and it is retried on the first online visit anyway.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1. A navigation — a page load or a reload. Network first, shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok && response.type === 'basic') {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put('/index.html', response.clone());
          }
          return response;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match('/index.html')) ||
            (await cache.match('/')) ||
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          );
        }
      })(),
    );
    return;
  }

  // 2. Hashed build assets — cache first, because their names cannot drift from their contents.
  if (url.pathname.startsWith(IMMUTABLE_PREFIX)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});
