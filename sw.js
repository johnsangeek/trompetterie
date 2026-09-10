"use strict";

const CACHE_NAME = "trumpet-trainer-v108";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./mobile.html",
  "./mobile.css",
  "./mobile.js",
  "./mobile-player.html",
  "./mobile-player.js",
  "./home.css",
  "./home.js",
  "./hero.html",
  "./hero.css",
  "./hero.js",
  "./hero-instrument.js",
  "./trompetterie-shell.css",
  "./trompetterie-shell.js",
  "./trumpet-workspace.html",
  "./home.html",
  "./training.html",
  "./karaoke.html",
  "./karaoke.css",
  "./karaoke.js",
  "./chords.html",
  "./chords.css",
  "./chords-midi.css",
  "./chords-roll.css",
  "./chords.js",
  "./style.css",
  "./trumpet-shell.css",
  "./assets/fonts/MiracleHistory.ttf",
  "./assets/fonts/VerandahReverie.otf",
  "./site.css",
  "./app.js",
  "./trumpet-3d.js",
  "./trumpet-fingering.js",
  "./trumpet-school.html",
  "./trumpet-school.css",
  "./trumpet-school.js",
  "./assets/trumpet/trumpet.glb",
  "./assets/trumpet-samples/C4.mp3",
  "./assets/trumpet-samples/F4.mp3",
  "./assets/trumpet-samples/G4.mp3",
  "./assets/trumpet-samples/As4.mp3",
  "./vendor/three/three.module.min.js",
  "./vendor/three/three.core.min.js",
  "./vendor/three/addons/loaders/GLTFLoader.js",
  "./vendor/three/addons/utils/BufferGeometryUtils.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./covers/soda-daoud.jpg",
  "./covers/soda-daoud-thumb.jpg",
  "./tracks/soda-daoud.json",
  "./tracks/all-blues.json",
  "./tracks/take-the-a-train.json",
  "./tracks/four-brothers.json",
  "./tracks/stolen-moments.json",
  "./tracks/cherokee.json",
  "./tracks/it-don-t-mean-a-thing.json",
  "./tracks/moanin.json",
  "./tracks/satin-doll.json",
  "./tracks/misty.json",
  "./tracks/mack-the-knife.json",
  "./tracks/on-green-dolphin-street.json",
  "./tracks/billie-s-bounce.json",
  "./tracks/st-thomas.json",
  "./tracks/new-york-new-york.json",
  "./tracks/b-y-t.json",
  "./tracks/a-night-in-tunisia.json",
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
