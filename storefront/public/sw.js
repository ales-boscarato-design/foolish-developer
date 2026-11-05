const CACHE_NAME = 'foolish-pwa-v2'
const CACHE_PREFIX = 'foolish-pwa-'
const OFFLINE_URL = '/offline.html'
const PRECACHE_URLS = [OFFLINE_URL, '/icon-192.png', '/icon-512.png']

// Risposta di emergenza se né la rete né il fallback statico sono disponibili.
// Deve restare identica per tutti: nessun dato personale, nessuna richiesta.
const EMERGENCY_HTML =
  '<!doctype html><html lang="it"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Offline — The Foolish Butcher</title></head><body>' +
  '<h1>Sei offline</h1><p>Controlla la connessione e riprova.</p>' +
  '<h1>You are offline</h1><p>Check your connection and try again.</p>' +
  '</body></html>'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

// Logout/cambio utente: elimina ogni cache dell'app e ricrea solo il precache
// statico. Nessuna pagina personale viene mai conservata.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'foolish:purge-personal-cache') return
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => caches.open(CACHE_NAME))
      .then((cache) => cache.addAll(PRECACHE_URLS))
  )
})

self.addEventListener('fetch', (event) => {
  // Solo le navigazioni: la rete vince sempre e la risposta non viene mai
  // scritta in cache. Offline si serve la pagina neutra, uguale per tutti.
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then(
        (cached) =>
          cached ||
          new Response(EMERGENCY_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
      )
    )
  )
})

// Web Push
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch { data = { body: event.data?.text() ?? '' } }
  const title = data.title ?? 'The Foolish Butcher'
  const options = {
    body: data.body ?? '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url ?? '/account' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      const url = event.notification.data?.url ?? '/account'
      for (const client of clientList) {
        if (client.url.includes('/account') && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
