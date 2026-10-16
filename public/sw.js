/*
 * AgriShop service worker — the file `src/main.tsx` has always asked for and never got.
 *
 * WHY THIS EXISTS
 *   `src/main.tsx` registers `/sw.js` in every production web build. The file did not exist, so the
 *   request fell through to the SPA rewrite in `vercel.json` and came back as `index.html` — HTTP
 *   200 with `text/html` — and the browser refused it:
 *
 *     The script has an unsupported MIME type ('text/html').
 *
 *   That was a console error on every production page load, and Add-to-Home-Screen never worked.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not cache the app shell, navigations or API responses. `src/main.tsx` already explains
 *   the reason on the native side — a caching worker "would only risk trapping the app on a stale
 *   bundle" — and the same risk applies to the web build: an owner who opens a cached `index.html`
 *   after a deploy keeps loading yesterday's JavaScript. Only `/assets/` is cached, because every
 *   file there carries a content hash, so a cached copy can never be a stale copy of anything else.
 *   Everything else — navigations, `/rest/v1/...` calls to Supabase, fonts — goes straight to the
 *   network, untouched.
 *
 *   There is no `install` precache list for the same reason: the shell is the one thing that must
 *   never come from a cache it cannot revalidate.
 */

const CACHE = 'agrishop-assets-v1';
const IMMUTABLE_PREFIX = '/assets/';

self.addEventListener('install', () => {
  // Take over without waiting for the previous worker's tabs to close; nothing is cached at install,
  // so there is no half-populated cache to inherit.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Prune every cache this version did not create, including this worker's own older names.
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Cross-origin is never cached: Supabase responses are per-user and must not be replayed.
  if (url.origin !== self.location.origin) return;
  // Everything that is not a hashed build asset is left to the network, by design.
  if (!url.pathname.startsWith(IMMUTABLE_PREFIX)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      // Only a real 200 from this origin is worth storing; a redirect or an opaque response is not.
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    })(),
  );
});
