/* 2MRRW - push notifications, keep-alive messaging, and immutable asset caching. */
const SW_VERSION = "account-gated-consumer-20260827";
const STATIC_CACHE = `2mrrw-static-${SW_VERSION}`;

const STATIC_PREFIXES = ["/_next/static/", "/icons/", "/fonts/"];
const SHELL_ASSETS = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

function isStaticAsset(url) {
  const { pathname } = new URL(url);
  return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) =>
            (key.startsWith("2mrrw-static-") && key !== STATIC_CACHE) ||
            key.startsWith("2mrrw-api-") ||
            key.startsWith("2mrrw-audio-")
          )
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin || !isStaticAsset(request.url)) return;

  event.respondWith(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        });
      })
    )
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object" || data.type !== "KEEP_ALIVE") return;
  const port = event.ports && event.ports[0];
  if (port) port.postMessage({ type: "KEEP_ALIVE_ACK", version: SW_VERSION, at: Date.now() });
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
          (client) => client.url.startsWith(self.location.origin) && "focus" in client
        );
        if (existing) return existing.focus().then((client) => client.navigate(url));
        return self.clients.openWindow(url);
      })
  );
});
