/**
 * Minimal browser-environment shim for the physical certification suite.
 *
 * MUST be imported before any production playback module. `getAudioEngineRuntime()`
 * branches on `typeof window` at import time; without these globals present first,
 * the runtime silently falls back to the SSR singleton and the real command queue
 * is never exercised.
 *
 * This shim fakes only the DOM/host surface. It fakes NOTHING inside the playback
 * pipeline itself — the real dispatcher, the real serial queue, the real emergency
 * bypass lane, the real watchdog, and the real command executor all run unmodified.
 */

class FakeAudioElement {
  constructor(src = "") {
    this.src = src;
    this.volume = 1;
    this.currentTime = 0;
    this.paused = true;
    this.isConnected = false;
    this.crossOrigin = null;
    this.preload = "none";
    this.style = {};
    this._attrs = {};
    this._listeners = new Map();
  }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k] ?? null; }
  addEventListener(t, fn) {
    if (!this._listeners.has(t)) this._listeners.set(t, new Set());
    this._listeners.get(t).add(fn);
  }
  removeEventListener(t, fn) { this._listeners.get(t)?.delete(fn); }
  dispatchEvent(evt) {
    for (const fn of this._listeners.get(evt?.type) ?? []) fn(evt);
    return true;
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
}

function installDomShim() {
  if (globalThis.window) return;

  const body = {
    children: [],
    appendChild(el) { el.isConnected = true; this.children.push(el); return el; },
    removeChild(el) { el.isConnected = false; return el; },
  };

  const documentShim = {
    body,
    visibilityState: "visible",
    hidden: false,
    createElement(tag) { return new FakeAudioElement(tag === "audio" ? "" : undefined); },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
  };

  const windowShim = {
    document: documentShim,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    location: { href: "http://localhost/", origin: "http://localhost" },
    navigator: { userAgent: "node-physical-harness", mediaSession: null },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: globalThis.performance,
    localStorage: {
      _d: new Map(),
      getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
      setItem(k, v) { this._d.set(k, String(v)); },
      removeItem(k) { this._d.delete(k); },
    },
  };

  globalThis.window = windowShim;
  globalThis.document = documentShim;
  // Node >= 21 defines `navigator` as a getter-only global — plain assignment
  // throws. Redefine it so production code that reads navigator.userAgent /
  // navigator.mediaSession sees the shim.
  Object.defineProperty(globalThis, "navigator", {
    value: windowShim.navigator,
    configurable: true,
    writable: true,
  });
  globalThis.localStorage = windowShim.localStorage;
  globalThis.Audio = FakeAudioElement;
  globalThis.requestAnimationFrame = windowShim.requestAnimationFrame;
  globalThis.cancelAnimationFrame = windowShim.cancelAnimationFrame;
}

installDomShim();

export { FakeAudioElement };
