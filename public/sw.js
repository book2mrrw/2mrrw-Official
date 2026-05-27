/* 2MRRW background audio keep-alive — minimal SW for Android Chrome session persistence */
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
