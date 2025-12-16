// R3, R11: Service Worker with Cache-First Strategy
const CACHE_NAME = 'lumina-v22-static-cache';
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/style.css',
    '/manifest.json',
    // R4: HTML Fallback for error handling (using cached assets)
    // Add path for icons if placed in /icons/
    // '/icons/icon-192x192.png', 
];

// Install Event: Caching the App Shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Caching App Shell');
                return cache.addAll(urlsToCache);
            })
    );
});

// Activate Event: Cleaning up old caches
self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log('Service Worker: Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Fetch Event: Cache-First Strategy
self.addEventListener('fetch', event => {
    // We only intercept requests for resources, not PDF uploads or external APIs 
    if (event.request.url.includes('pexels.com') || event.request.url.includes('picsum.photos')) {
        // Network-First or simple fetch for dynamic content/APIs
        event.respondWith(fetch(event.request));
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response (Cache-First)
                if (response) {
                    return response;
                }
                // No cache hit - fetch from network
                return fetch(event.request);
            })
    );
});