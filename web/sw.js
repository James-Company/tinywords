/**
 * TinyWords Service Worker — Web Push 알림 수신 및 표시
 */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "TinyWords", body: event.data.text() };
  }

  const title = payload.title || "TinyWords";
  const options = {
    body: payload.body || "",
    icon: payload.icon || undefined,
    badge: payload.badge || undefined,
    tag: payload.tag || "tinywords-reminder",
    data: { url: payload.url || "/" },
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // 이미 열린 탭이 있으면 포커스
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // 없으면 새 탭 열기
      return self.clients.openWindow(url);
    }),
  );
});
