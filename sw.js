"use strict";

const CACHE_NAME = "trumpet-trainer-v27";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./home.html",
  "./training.html",
  "./style.css",
  "./site.css",
  "./app.js",
  "./trumpet-3d.js",
  "./assets/trumpet/trumpet.glb",
  "./vendor/three/three.module.min.js",
  "./vendor/three/addons/loaders/GLTFLoader.js",
  "./vendor/three/addons/utils/BufferGeometryUtils.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./covers/soda-daoud.jpg",
  "./covers/soda-daoud-thumb.jpg",
  "./tracks/soda-daoud.json",
  "https://cdn.jsdelivr.net/npm/vexflow@4.2.2/build/cjs/vexflow.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: while the app is under active development, always prefer
// a fresh copy so updates show up immediately - the cache is purely an
// offline fallback (used only when the network fetch itself fails), not the
// primary source. (A cache-first strategy is nicer once things stabilize,
// since installed PWAs - especially on iOS - can be slow to notice a new
// service worker otherwise; but it trades away instant updates in the
// meantime, which matters more right now.)
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
