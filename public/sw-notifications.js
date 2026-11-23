/* eslint-disable no-restricted-globals */
// Service Worker extension for TH3 BNB Repair Push Notifications.
// Imported into the Workbox-generated /sw.js via importScripts.

self.addEventListener('push', function (event) {
  var payload = {
    title: 'Reparación lista · TH3 BNB',
    body: 'Una reparación cambió a estado Listo / Terminado.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'th3bnb-repair-ready',
    data: { url: '/' },
  };

  if (event.data) {
    try {
      var parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = Object.assign({}, payload, parsed, {
          data: Object.assign({}, payload.data, parsed.data || {}),
        });
      }
    } catch (_err) {
      var text = '';
      try {
        text = event.data.text();
      } catch (_e) {
        text = '';
      }
      if (text) payload.body = text;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || '/pwa-192x192.png',
      badge: payload.badge || '/pwa-192x192.png',
      tag: payload.tag || 'th3bnb-repair-ready',
      renotify: true,
      vibrate: [120, 60, 120],
      data: payload.data || { url: '/' },
    })
  );
});

self.addEventListener('message', function (event) {
  var msg = event && event.data;
  if (!msg || msg.type !== 'SHOW_REPAIR_NOTIFICATION') return;
  var p = msg.payload || {};
  var title = p.title || 'Reparación lista · TH3 BNB';
  var options = {
    body: p.body || 'El equipo ya se encuentra listo para entregar.',
    icon: p.icon || '/pwa-192x192.png',
    badge: p.badge || '/pwa-192x192.png',
    tag: p.tag || 'th3bnb-repair-ready',
    renotify: true,
    vibrate: [120, 60, 120],
    data: p.data || { url: '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = (event.notification && event.notification.data) || {};
  var repairId = data.repairId || '';
  var code = data.code || '';
  var targetUrl = data.url || (repairId ? '/?repairId=' + encodeURIComponent(repairId) : '/');

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client) {
            return client.focus().then(function (focusedClient) {
              if (focusedClient && repairId) {
                focusedClient.postMessage({
                  type: 'TH3_OPEN_REPAIR',
                  repairId: repairId,
                  code: code,
                });
              }
              return focusedClient;
            });
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
