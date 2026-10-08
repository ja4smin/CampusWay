const CACHE_NAME = 'campusway-v64-compact-route-directions';

const APP_FILES = [
'./',
  './index.html',
  './manifest.json',

  './app/vendor/leaflet.css',
  './app/vendor/leaflet.js',
  './app/vendor/images/cw2.png',

  './app/ui/campusway.css',
  './app/ui/campus-map.css',
  './app/ui/campus-ui.js',
  './app/ui/indoor-nav.css',
  './app/ui/qr-code.js',
  './app/ui/share.js',
  './app/ui/campus-status.js',
  './app/data/campus-status.json',

  './app/prototype/data.js',
  './app/prototype/outdoor-routing.js',
  './app/prototype/route-instructions.js',
  './app/prototype/campus-osm.json',
  './app/prototype/madriga-graph.js',
  './app/prototype/multi-purpose-graph.js',

  './wayframe/navigation-demo.html',
  './wayframe/step-detector.js',
  './wayframe/heading-tracker.js',
  './wayframe/route-progress.js',
  './wayframe/wheelchair-navigation.js',
  './wayframe/route-planner.js',
  './wayframe/sensor-test.html',
  './wayframe/audio-guide.js',
  './wayframe/audio-test.html',
  './wayframe/mic-test.html',

  './buildings/education/education-indoor-graph.json',
  './buildings/education/floors/floor1.svg',
  './buildings/education/floors/floor2.svg',
  './buildings/education/floors/floor3.svg',
  './buildings/education/floors/floor4.svg',
  './buildings/education/floors/floor5.svg',
  './buildings/education/floors/floor6.svg',

  './buildings/madriga/madriga-indoor-graph.json',
  './buildings/madriga/floors/floorminus1.svg',
  './buildings/madriga/floors/floor0.svg',
  './buildings/madriga/floors/floor1.svg',
  './buildings/madriga/floors/floor2.svg',
  './buildings/madriga/floors/floor3.svg',
  './buildings/madriga/floors/floor4.svg',

  './buildings/main/main-indoor-graph.json',
  './buildings/main/floors/500-Model.svg',
  './buildings/main/floors/600-Model.svg',
  './buildings/main/floors/700-Model.svg',

  './buildings/multi-purpose/multi-purpose-indoor-graph.json',
  './buildings/multi-purpose/floors/floor1.svg',

  './buildings/rabin/rabin-indoor-graph.json',
  './buildings/rabin/floors/floor5.svg',
  './buildings/rabin/floors/floor6.svg',
  './buildings/rabin/floors/floor7.svg',

  './buildings/student/student-indoor-graph.json',
  './buildings/student/floors/floor0.svg',
  './buildings/student/floors/floor1.svg',
  './buildings/student/floors/floor2.svg',
  './buildings/student/floors/floor3.svg',
  './buildings/student/floors/floor4.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names =>
        Promise.all(
          names
            .filter(name => name !== CACHE_NAME)
            .map(name => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {

  // Only handle normal GET requests.
  if(event.request.method !== 'GET'){
    return;
  }

  const requestUrl = new URL(event.request.url);

  // External map tiles are handled directly by the browser.
  if(requestUrl.origin !== self.location.origin){
    return;
  }

  function networkFirst({ignoreSearch = false} = {}){
    return fetch(event.request)
      .then(response => {
        if(response.ok){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, {ignoreSearch}));
  }

  // Live campus status: try the network first so new outages and closures
  // show up at once; use the saved copy when offline.
  if(requestUrl.pathname.endsWith('/app/data/campus-status.json')){
    event.respondWith(
      networkFirst({ignoreSearch: true})
    );
    return;
  }

  // App-shell files change between releases. Fetch them from the network
  // first so an old cached indoor page cannot miss new preferences or styles.
  // Their precached copies still keep the app available without a connection.
  const needsFreshAppShell =
    requestUrl.origin === self.location.origin &&
    (
      event.request.mode === 'navigate' ||
      event.request.destination === 'document' ||
      event.request.destination === 'style' ||
      event.request.destination === 'script'
    );

  if(needsFreshAppShell){
    event.respondWith(
      networkFirst({
        ignoreSearch:
          event.request.mode === 'navigate' ||
          event.request.destination === 'document'
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, {
  ignoreSearch: true
})
      .then(cached => {

        if(cached){
          return cached;
        }

        return fetch(event.request);
      })
  );
});
