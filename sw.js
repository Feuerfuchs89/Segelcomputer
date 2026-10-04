/*
 * SegelComp – Service Worker
 * Cached die App-Shell (HTML/Manifest/Icons), damit die App auch ohne
 * Netzverbindung startet. Externe Ressourcen (Google Fonts, Leaflet-CDN,
 * OSM-Kartenkacheln, Wetter-API) laufen normal übers Netz, werden aber
 * per stale-while-revalidate zusätzlich zwischengespeichert, wenn sie
 * einmal geladen wurden – so funktioniert z.B. die zuletzt gesehene
 * Kartenansicht auch offline weiter.
 */

const CACHE_VERSION = 'v2';
const APP_SHELL_CACHE = `segelcomp-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `segelcomp-runtime-${CACHE_VERSION}`;

const APP_SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isAppShellRequest(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (isAppShellRequest(url)) {
    // App-Shell: Cache-first, damit die App sofort & offline startet.
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put(req, copy));
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Externe Ressourcen (Fonts, Leaflet, Kartenkacheln, Wetter-API):
  // stale-while-revalidate – sofort aus dem Cache liefern (falls vorhanden)
  // und im Hintergrund aktualisieren, damit spätere Offline-Nutzung
  // (z.B. zuletzt gesehene Kartenkacheln) funktioniert.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});
