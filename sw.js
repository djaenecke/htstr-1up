const CACHE_NAME = 'htstr1up-v1';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './manifest.json',
    './card-back.png',
    './data/hitster-de-aaaa0007.csv',
    './data/hitster-de-aaaa0012.csv',
    './data/hitster-de-aaaa0015.csv',
    './data/hitster-de-aaaa0019.csv',
    './data/hitster-de-aaaa0025.csv',
    './data/hitster-de-aaaa0026.csv',
    './data/hitster-de-aaaa0039.csv',
    './data/hitster-de-aaaa0040.csv',
    './data/hitster-de-aaaa0042.csv',
    './data/hitster-de.csv',
    './data/hitster-fr-aaaa0031.csv',
    './data/hitster-fr.csv',
    './data/hitster-nl.csv',
    './data/hitster-nordics.csv',
    './data/hitster-pl-aaae0001.csv',
    './data/hitster-hu-aaae0003.csv',
    './data/hitster-ca-aaad0001.csv'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // Don't cache Spotify API calls
    if (event.request.url.includes('spotify.com') ||
        event.request.url.includes('scdn.co')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(cached => cached || fetch(event.request))
    );
});
