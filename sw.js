/* Service worker – hogy az app kitűzhető legyen a kezdőképernyőre,
   és gyenge hálózatnál is elinduljon.

   Szándékosan "network-first": mindig a friss fájlt tölti le, és csak
   hálózati hiba esetén nyúl a gyorsítótárhoz. Így nem fordul elő, hogy
   egy feltöltött javítás "nem jelenik meg". */

const CACHE = "videa-v1";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./search.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .catch(function () { /* egy hiányzó fájl ne akassza meg a telepítést */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // A videa.hu-t és a proxyt hagyjuk a hálózatra (ne cache-eljük a találatokat)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("./index.html");
        });
      })
  );
});
