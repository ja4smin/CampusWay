const CACHE_NAME = 'campusway-v10';

const APP_FILES = [
'./',
  './index.html',
  './manifest.json',

  './app/vendor/leaflet.css',
  './app/vendor/leaflet.js',
  './app/vendor/images/cw2.png',

  './app/prototype/data.js',
  './app/prototype/outdoor-routing.js',
  './app/prototype/campus-osm.json',
  './app/prototype/madriga-graph.js',
  './app/prototype/main-graph.js',
  './app/prototype/rabin-graph.js',
  './app/prototype/student-graph.js',
  './app/prototype/multi-purpose-graph.js',
  './app/prototype/indoor.js',

  './wayframe/navigation-demo.html',

  './buildings/education/education-indoor-graph.json',
  './buildings/education/floors/floor0.svg',
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
  './buildings/multi-purpose/floors/floorminus1.svg',
  './buildings/multi-purpose/floors/floor0.svg',
  './buildings/multi-purpose/floors/floor1.svg',
  './buildings/multi-purpose/floors/floor2.svg',

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
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    )
  );
});

self.addEventListener('fetch', event => {

  // Only handle normal GET requests.
  if(event.request.method !== 'GET'){
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