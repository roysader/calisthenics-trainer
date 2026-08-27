const CACHE_NAME = 'calisthenics-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './store.js',
  './supabaseClient.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin app-shell requests; let Supabase/API calls pass through to the network.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  // Network-first: always try to fetch the latest version when online, and
  // only fall back to the cached copy when offline. This keeps the installed
  // PWA up to date instead of permanently pinning whatever was first cached.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
