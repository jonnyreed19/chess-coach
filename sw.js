const CACHE_NAME = "chess-coach-v24";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=24",
  "./app.js?v=24",
  "./manifest.webmanifest",
  "./icon.svg",
  "./vendor/stockfish/stockfish-nnue-16-single.js",
  "./vendor/stockfish/stockfish-nnue-16-single.wasm",
  "./vendor/stockfish/license.txt",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
