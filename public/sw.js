/* 2MRRW — background audio keep-alive + web push notifications */
const SW_VERSION = "universal-background-audio-20260527";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type !== "KEEP_ALIVE") return;
  const port = event.ports && event.ports[0];
  if (port) {
    port.postMessage({ type: "KEEP_ALIVE_ACK", version: SW_VERSION, at: Date.now() });
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "2MRRW", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "2MRRW";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: payload.url || "/" },
    tag: payload.tag || "2mrrw",
    renotify: Boolean(payload.renotify),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find(
          (c) => c.url.startsWith(self.location.origin) && "focus" in c
        );
        if (existing) return existing.focus().then((c) => c.navigate(url));
        return self.clients.openWindow(url);
      })
  );
});
