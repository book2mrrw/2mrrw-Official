"use client";

const CHANNEL = "2mrrw:catalog-refresh:v1";
export const CATALOG_REFRESH_INTERVAL_MS = 30_000;
const browser = () => typeof window === "undefined" ? null : { window, document };

// One owner per document, shared by catalog surfaces and editorial modals.
// Messages carry invalidations only; every consumer reads the server.
export function createCatalogRefreshStore(environment = browser) {
  let revision = 0;
  const listeners = new Set();
  let dispose = null;
  let channel = null;
  const notify = () => {
    revision += 1;
    for (const listener of [...listeners]) listener();
    return revision;
  };
  function announce() {
    const env = environment();
    if (!env) return;
    const message = { type: "catalog-invalidated", version: 1, nonce: env.window.crypto?.randomUUID?.() || `${Date.now()}:${Math.random()}` };
    try {
      if (channel) channel.postMessage(message);
      else if (env.window.BroadcastChannel) {
        const temporary = new env.window.BroadcastChannel(CHANNEL);
        temporary.postMessage(message);
        temporary.close();
      } else throw new Error("BroadcastChannel unavailable");
      return;
    } catch { /* Fall through when tab transport is unavailable or blocked. */ }
    try {
      env.window.localStorage.setItem(CHANNEL, JSON.stringify(message));
      env.window.localStorage.removeItem(CHANNEL);
    } catch { /* The revision poll also covers unavailable tab transport. */ }
  }
  function start() {
    const env = environment();
    if (!env) return;
    const { window: win, document: doc } = env;
    let stopped = false;
    let controller = null;
    let timeout = null;
    let serverRevision = null;
    const receive = message => {
      if (message?.type === "catalog-invalidated" && message.version === 1 && typeof message.nonce === "string") notify();
    };
    const storage = event => {
      if (event.key !== CHANNEL || !event.newValue) return;
      try { receive(JSON.parse(event.newValue)); } catch { /* Ignore malformed messages. */ }
    };
    try {
      if (win.BroadcastChannel) {
        channel = new win.BroadcastChannel(CHANNEL);
        channel.onmessage = event => receive(event.data);
      }
    } catch { channel = null; }
    win.addEventListener("storage", storage);
    const poll = async () => {
      if (stopped || doc.visibilityState === "hidden" || win.navigator?.onLine === false || controller) return;
      const request = new AbortController();
      controller = request;
      timeout = win.setTimeout(() => request.abort(), 10_000);
      try {
        const response = await win.fetch("/api/catalog/releases?view=revision", { cache: "no-store", signal: request.signal });
        const data = await response.json();
        if (stopped || request.signal.aborted || !response.ok || !/^[a-f0-9]{64}$/.test(data?.revision)) return;
        if (data.revision !== serverRevision) {
          serverRevision = data.revision;
          notify();
        }
      } catch { /* Retain the verified revision until the next bounded tick. */ }
      finally {
        win.clearTimeout(timeout);
        if (controller === request) controller = null;
      }
    };
    const visibility = () => {
      if (doc.visibilityState === "hidden") controller?.abort();
      else void poll();
    };
    const timer = win.setInterval(poll, CATALOG_REFRESH_INTERVAL_MS);
    win.addEventListener("focus", poll);
    win.addEventListener("online", poll);
    doc.addEventListener("visibilitychange", visibility);
    void poll();
    dispose = () => {
      stopped = true;
      controller?.abort();
      win.clearTimeout(timeout);
      win.clearInterval(timer);
      win.removeEventListener("storage", storage);
      win.removeEventListener("focus", poll);
      win.removeEventListener("online", poll);
      doc.removeEventListener("visibilitychange", visibility);
      channel?.close();
      channel = null;
    };
  }
  return {
    getCatalogRefreshRevision: () => revision,
    getCatalogRefreshServerRevision: () => 0,
    subscribeCatalogRefresh(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        if (listeners.size === 0) { dispose?.(); dispose = null; }
      };
    },
    signalCatalogMutation(reason = "catalog_mutation") {
      void reason;
      const next = notify();
      announce();
      return next;
    },
  };
}

export const {
  getCatalogRefreshRevision, getCatalogRefreshServerRevision,
  subscribeCatalogRefresh, signalCatalogMutation,
} = createCatalogRefreshStore();
