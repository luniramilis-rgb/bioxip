const VERSION = "bioxip-v4";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/css/app.css",
  "/css/topik.css",
  "/js/brand.js",
  "/js/topics.js",
  "/js/search.js",
  "/js/answer.js",
  "/js/drug.js",
  "/js/interactions.js",
  "/js/credits.js",
  "/js/ai.js",
  "/js/saldo.js",
  "/js/app.js",
  "/data/topics.json",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/topik/",
  "/og/bioxip-og.png",
];
const FRESH_ASSETS = ["/css/", "/js/", "/icons/", "/data/", "/manifest.json", "/topik/", "/og/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  if (FRESH_ASSETS.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request);
    }),
  );
});
