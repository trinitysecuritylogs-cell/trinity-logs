/* Trinity Daily Log — Service Worker
 * ------------------------------------------------------------------
 * Built on Workbox v7 (loaded from Google's CDN on install).
 *
 * Responsibilities (mapped to SPEC):
 *   HR6  Offline page load.   We precache index.html, Form.html and
 *        the Dexie CDN bundle during install, so the PWA opens even
 *        with no network.
 *   HR7  Updates propagate.   Bump SW_VERSION on every deploy. The
 *        browser refetches sw.js when navigating, notices the bytes
 *        changed, installs the new SW, and skipWaiting/clientsClaim
 *        hand control to it immediately. The NEXT navigation serves
 *        the freshly precached HTML.
 *   HR9  Recovery from bad cache.  Listens for postMessage of
 *        { type:'KILL_SWITCH' } from a page, deletes every cache it
 *        owns, and unregisters itself.  (The page also clears
 *        IndexedDB + localStorage and then reloads.)
 *
 * IMPORTANT: bump SW_VERSION on every deploy that touches a precached
 * file (index.html, Form.html, manifest.json). Workbox uses the
 * version string as the precache revision; if it doesn't change, the
 * new bytes won't be picked up. The version stamps in the page
 * footers ("Form v2026-…") should be bumped in lockstep with this.
 * ------------------------------------------------------------------ */

const SW_VERSION = '2026-06-11-v2';

importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js');

workbox.setConfig({ debug: false });

workbox.core.setCacheNameDetails({
  prefix: 'trinity-logs',
  suffix: SW_VERSION,
  precache: 'precache',
  runtime:  'runtime'
});

// As soon as a new SW finishes installing, take over open pages so that
// the very next navigation serves the new build.
self.skipWaiting();
workbox.core.clientsClaim();

// ------------------------------------------------------------------
//  Precache — the bare minimum needed to open the app offline.
// ------------------------------------------------------------------
//  - HTML pages and manifest use SW_VERSION as the revision so that
//    bumping SW_VERSION causes Workbox to re-fetch them.
//  - Dexie is pinned to a fixed CDN URL; bytes never change, no
//    revision needed (Workbox handles the "must succeed once" install
//    semantics for us).
workbox.precaching.precacheAndRoute([
  { url: 'index.html',                                                       revision: SW_VERSION },
  { url: 'Form.html',                                                        revision: SW_VERSION },
  { url: 'manifest.json',                                                    revision: SW_VERSION },
  { url: 'inter.woff2',                                                      revision: null },
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/dexie/3.2.7/dexie.min.js',  revision: null }
]);

// Offline navigation fallback. If the user lands on a URL that isn't
// directly in the precache (e.g. "/trinity-logs/" with no trailing
// path, or any 404), serve the precached index.html so the SPA shell
// still loads. Without this, navigating to the bare directory URL
// while offline shows "no internet" instead of the app.
workbox.routing.registerRoute(
  ({ request }) => request.mode === 'navigate',
  new workbox.strategies.NetworkFirst({
    cacheName: 'trinity-logs-pages-' + SW_VERSION,
    networkTimeoutSeconds: 4,
    plugins: [{
      handlerDidError: async () => {
        const cacheKey = workbox.precaching.getCacheKeyForURL('index.html');
        return cacheKey ? caches.match(cacheKey) : Response.error();
      }
    }]
  })
);

// Submit endpoint: never cache. The page is solely responsible for
// handling success / failure modals.
workbox.routing.registerRoute(
  ({ url }) => url.href.includes('daily-log-relay.trinitysecuritylogs.workers.dev'),
  new workbox.strategies.NetworkOnly()
);

// Workbox runtime itself (loaded from googleapis on install): cache-first
// so the SW can boot offline after the first online install.
workbox.routing.registerRoute(
  ({ url }) => url.href.includes('storage.googleapis.com/workbox-cdn/'),
  new workbox.strategies.CacheFirst({
    cacheName: 'trinity-logs-vendor-' + SW_VERSION
  })
);

// ------------------------------------------------------------------
//  HR9 — Kill switch.
// ------------------------------------------------------------------
// The page can postMessage({ type: 'KILL_SWITCH' }) to this SW. We
// then delete every cache we own and unregister this SW. The page is
// expected to reload itself afterwards — the reload pulls everything
// fresh from the network.
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'KILL_SWITCH') {
    event.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.postMessage({ type: 'KILL_SWITCH_DONE' }));
    })());
  }

  // Lets the page ask a freshly-installed SW to take over immediately.
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// On activate, clean up caches left behind by an older SW_VERSION. Without
// this, every version bump leaves orphaned caches until storage pressure
// forces eviction.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('trinity-logs') && !n.endsWith(SW_VERSION))
        .map((n) => caches.delete(n))
    );
  })());
});
