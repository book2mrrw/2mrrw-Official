/* 2MRRW — background audio keep-alive + web push notifications + static asset caching */
const SW_VERSION = "universal-background-audio-20260720";
// All three cache names are tied to SW_VERSION so a single version bump atomically
// invalidates static assets, API responses, and audio previews on next SW update.
const STATIC_CACHE = `2mrrw-static-${SW_VERSION}`;
const API_CACHE = `2mrrw-api-${SW_VERSION}`;
const AUDIO_CACHE = `2mrrw-audio-${SW_VERSION}`;

// Public catalog/events routes safe to cache offline (no auth, public data).
const CACHEABLE_API_PREFIXES = [
  "/api/catalog/releases",
  "/api/public/events",
];

const STATIC_PREFIXES = ["/_next/static/", "/icons/", "/fonts/"];

function isStaticAsset(url) {
  const { pathname } = new URL(url);
  return STATIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function isCacheableApi(url) {
  const { pathname } = new URL(url);
  return CACHEABLE_API_PREFIXES.some((p) => pathname.startsWith(p));
}

function isAudioPreview(url) {
  const { pathname } = new URL(url);
  return pathname.startsWith("/api/media/preview");
}

// Pre-cache stable shell assets on install so icons and manifest are available
// before first network access (critical for offline notification display and
// PWA install prompt). Only truly static files — not the HTML shell, which is
// server-rendered and changes per-deploy.
const SHELL_ASSETS = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  // Remove caches from old versions — both static and API caches.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) =>
            (k.startsWith("2mrrw-static-") && k !== STATIC_CACHE) ||
            (k.startsWith("2mrrw-api-") && k !== API_CACHE) ||
            (k.startsWith("2mrrw-audio-") && k !== AUDIO_CACHE)
          )
          .map((k) => caches.delete(k))
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

  // Never intercept cross-origin requests
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(request.url)) {
    // Cache-first for immutable static assets (Next.js build hashes guarantee freshness)
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
    return;
  }

  if (isCacheableApi(request.url)) {
    // Network-first for public catalog/events API: serve fresh, fall back to cache if offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(API_CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.open(API_CACHE).then((cache) => cache.match(request)))
    );
    return;
  }

  if (isAudioPreview(request.url)) {
    // Cache-first for audio previews — immutable after release, large files benefit from
    // single fetch. Served from cache on subsequent plays and when offline.
    event.respondWith(
      caches.open(AUDIO_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // All other same-origin requests fall through to network (no SW involvement)
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
