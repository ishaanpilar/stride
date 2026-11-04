

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', (event) => {
  if (event.data === 'stride-service-worker-mode') {
    event.source?.postMessage('stride-service-worker-online-only');
  }
});
