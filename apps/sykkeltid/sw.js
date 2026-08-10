/* Service worker for tidtakingsappen.
   Skallet caches slik at en post som mister dekningen fortsatt kan laste appen
   paa nytt (for eksempel etter at telefonen har startet om midt i loepet).
   API-kall gaar aldri gjennom cachen - de skal feile aapent, slik at klienten
   legger hendelsene i ko i stedet for aa faa servert gammelt svar. */
var CACHE = 'sykkeltid-v3';
var SKALL = ['./', './index.html', './tv.html', './felles.js', './manifest.json',
             './ikon.svg', './ikon.png', './logo.png'];

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SKALL); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (navn) {
    return Promise.all(navn.filter(function (n) { return n !== CACHE; })
      .map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (ev) {
  var url = new URL(ev.request.url);
  if (ev.request.method !== 'GET') return;
  if (url.pathname.indexOf('/api/') === 0) return;   // aldri cache

  ev.respondWith(
    fetch(ev.request).then(function (svar) {
      if (svar && svar.ok && url.origin === location.origin) {
        var kopi = svar.clone();
        caches.open(CACHE).then(function (c) { c.put(ev.request, kopi); });
      }
      return svar;
    }).catch(function () {
      return caches.match(ev.request).then(function (traff) {
        return traff || caches.match('./index.html');
      });
    })
  );
});
