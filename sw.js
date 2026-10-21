// NoPrecinho service worker: cache-first with background refresh.
const C = "noprecinho-v2";
const PRECACHE = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/fonts/robotoslab.woff2",
  "./assets/fonts/jetbrainsmono.woff2"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(C)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      // Always try to refresh in the background
      const net = fetch(e.request).then(r => {
        if (r && r.ok) {
          const cp = r.clone();
          caches.open(C).then(c => c.put(e.request, cp));
        }
        return r;
      }).catch(() => {
        // Network failed — return cached fallback or the root document
        return hit || caches.match("./index.html");
      });
      // Return the cached version immediately if available, otherwise wait for network
      return hit || net;
    })
  );
});
