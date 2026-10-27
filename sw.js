// Offline support. Bump VERSION whenever any app file changes.
// The cache holds only app code; user records live in IndexedDB and are
// never touched by the service worker.
const VERSION = 'mwt-v1.1.0';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/state.js', 'js/db.js', 'js/dates.js', 'js/model.js', 'js/calc.js', 'js/format.js',
  'js/ui.js', 'js/components.js', 'js/charts.js', 'js/backup.js',
  'js/home.js', 'js/checkin.js', 'js/progress.js', 'js/history.js', 'js/settings.js', 'js/restore.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('mwt-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit ||
      fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
