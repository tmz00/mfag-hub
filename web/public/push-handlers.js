// Fired when the push subscription is invalidated (e.g. OS-level permission revoked on Android).
// Broadcast to all open clients so they can re-check and update the UI.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: "pushsubscriptionchange" });
        }
      })
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_err) {
    data = {};
  }

  const title = data.title || "MFAG Hub";
  const rawNotificationId =
    typeof data.notificationId === "number"
      ? data.notificationId
      : Number.parseInt(String(data.notificationId || ""), 10);
  const notificationId = Number.isFinite(rawNotificationId) && rawNotificationId > 0
    ? rawNotificationId
    : null;
  const detailUrl =
    data.url && typeof data.url === "string"
      ? data.url
      : notificationId
        ? `/notifications/${encodeURIComponent(String(notificationId))}`
        : "/notifications";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons//pwa-192x192.png",
    badge: data.badge || "/icons//notification-badge-192x192.png",
    tag: data.tag || "mfag-notification",
    data: {
      notificationId,
      url: detailUrl,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawNotificationId =
    event.notification &&
    event.notification.data &&
    typeof event.notification.data.notificationId === "number"
      ? event.notification.data.notificationId
      : Number.parseInt(
          String(
            event.notification &&
              event.notification.data &&
              event.notification.data.notificationId
              ? event.notification.data.notificationId
              : "",
          ),
          10,
        );
  const notificationId = Number.isFinite(rawNotificationId) && rawNotificationId > 0
    ? rawNotificationId
    : null;
  const targetUrl =
    (event.notification && event.notification.data && event.notification.data.url) ||
    (notificationId
      ? `/notifications/${encodeURIComponent(String(notificationId))}`
      : null) ||
    "/notifications";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
