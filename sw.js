/* MedieStudio service worker — app-skallen i cache, så appen virker offline.
   Navigationer (index.html) hentes net-først: en ny version når ud uden at
   VERSION skal bumpes, og cachen er kun reserve når nettet er væk.
   Øvrige filer (css, ikoner, fonte, mp4-muxer) er cache-først.
   Registreres IKKE når appen serveres lokalt (fx fra GenStudio på :8340). */
const VERSION = 'mediestudio-v5';
const SHELL = [
  './',
  './index.html',
  './ds.css',
  './icons.svg',
  './mp4-muxer.min.js',
  './manifest.webmanifest',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './fonts/chakra-petch-500.woff2',
  './fonts/chakra-petch-600.woff2',
  './fonts/chakra-petch-700.woff2',
  './fonts/barlow-400.woff2',
  './fonts/barlow-500.woff2',
  './fonts/barlow-600.woff2',
  './fonts/barlow-700.woff2'
];

self.addEventListener('install', e => {
  /* cache:'reload' går uden om HTTP-cachen (sitet sender max-age=600), så en
     ny version aldrig gemmer en gammel index.html under sit nye navn. */
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function shellFromCache(req) {
  return caches.match(req, { ignoreSearch: true })
    .then(hit => hit || caches.match('./index.html'))
    .then(hit => hit || caches.match('./'));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    /* Net først (genvalideret mod serveren), cache som reserve. Svarer nettet
       ikke inden 5 s, og der er en cachet kopi, bruges den. */
    e.respondWith(new Promise(resolve => {
      let done = false;
      const finish = r => { if (!done && r) { done = true; resolve(r); } };
      const slow = setTimeout(() => shellFromCache(req).then(finish), 5000);
      fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }))
        .then(res => {
          clearTimeout(slow);
          /* Kun selve appen gemmes (roden eller index.html, som HTML), og under
             begge navne: './' er manifestets start_url og matches først offline.
             En anden navigation (fx licensfilen) må aldrig ende som app-skallen. */
          const u = new URL(req.url), root = new URL(self.registration.scope).pathname;
          if (res.ok && u.origin === location.origin && (u.pathname === root || u.pathname === root + 'index.html') &&
              /text\/html/i.test(res.headers.get('content-type') || '')) {
            const a = res.clone(), b = res.clone();
            caches.open(VERSION).then(c => Promise.all([c.put('./', a), c.put('./index.html', b)]));
          }
          finish(res);
        })
        .catch(() => {
          clearTimeout(slow);
          shellFromCache(req).then(hit => finish(hit || Response.error()));
        });
    }));
    return;
  }

  e.respondWith(
    caches.match(req).then(hit =>
      hit ||
      fetch(req).then(res => {
        if (res.ok && new URL(req.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
    )
  );
});
