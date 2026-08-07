self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existente = clients.find((client) => 'focus' in client)
      if (existente) return existente.focus()
      if (self.clients.openWindow) return self.clients.openWindow('/')
      return undefined
    }),
  )
})
