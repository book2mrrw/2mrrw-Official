/**
 * Phase 13 — temporary black-screen forensic tracing (diagnostics only).
 * Enable: NEXT_PUBLIC_BLACKSCREEN_TRACE=1
 */

import { getAudioEngineRefs } from "@/lib/playback/audio-engine-runtime";

const RING_SIZE = 100;

/** @type {Array<Record<string, unknown>>} */
const ringBuffer = [];

/** @type {Record<string, { mount: number; unmount: number }>} */
const mountCounts = {};

let initialized = false;
let beforeUnloadPending = false;
let layoutMountGeneration = 0;
/** @type {(() => void) | null} */
let scrollTeardown = null;

/** @type {number | null} */
let lastWindowScrollY = null;
/** @type {number | null} */
let lastMainScrollTop = null;

const PLAYBACK_COMMANDS_OF_INTEREST = new Set([
  "PLAY_TRACK",
  "PAUSE",
  "RESUME",
  "STOP",
  "REPLACE_TRACK",
  "UPGRADE_STREAM",
  "RECOVER_PLAYBACK",
  "play",
  "pause",
  "resume",
  "stop",
  "replaceTrack",
  "upgradeStream",
  "recoverPlayback",
]);

export function isBlackscreenTraceEnabled() {
  if (typeof window === "undefined") return false;
  return process.env.NEXT_PUBLIC_BLACKSCREEN_TRACE === "1";
}

function ts() {
  return Date.now();
}

function prefixLog(prefix, payload) {
  console.log(prefix, payload);
}

/**
 * @param {string} category
 * @param {Record<string, unknown>} [data]
 */
export function pushBlackscreenEvent(category, data = {}) {
  if (!isBlackscreenTraceEnabled()) return;
  const entry = { category, timestamp: ts(), ...data };
  ringBuffer.push(entry);
  while (ringBuffer.length > RING_SIZE) {
    ringBuffer.shift();
  }
}

export function dumpBlackscreenRingBuffer(reason = "manual") {
  if (!isBlackscreenTraceEnabled()) return;
  prefixLog("[BLACKSCREEN-DUMP]", {
    reason,
    timestamp: ts(),
    count: ringBuffer.length,
    events: ringBuffer.slice(),
    mountCounts: { ...mountCounts },
    layoutMountGeneration,
  });
}

function readAudioPlaybackSnapshot() {
  try {
    const { audioRef } = getAudioEngineRefs();
    const audio = audioRef?.current;
    return {
      currentTime: audio?.currentTime ?? null,
      paused: audio?.paused ?? null,
      readyState: audio?.readyState ?? null,
      src: audio?.src ? String(audio.src).slice(0, 120) : null,
    };
  } catch {
    return { currentTime: null, paused: null, readyState: null, src: null };
  }
}

/**
 * @param {string} commandType
 * @param {Record<string, unknown>} [meta]
 */
export function logBlackscreenPlayback(commandType, meta = {}) {
  if (!isBlackscreenTraceEnabled()) return;
  const normalized = String(commandType || "").replace(/^.*\./, "");
  const alias = normalized.toUpperCase();
  const interested =
    PLAYBACK_COMMANDS_OF_INTEREST.has(commandType) ||
    PLAYBACK_COMMANDS_OF_INTEREST.has(normalized) ||
    PLAYBACK_COMMANDS_OF_INTEREST.has(alias);
  if (!interested) return;

  const audio = readAudioPlaybackSnapshot();
  const payload = {
    timestamp: ts(),
    command: commandType,
    track:
      meta.trackId ??
      meta.track ??
      meta.slug ??
      null,
    currentTime: audio.currentTime,
    isPlaying: meta.isPlaying ?? null,
    audioPaused: audio.paused,
    ...meta,
  };
  pushBlackscreenEvent("playback", payload);
  prefixLog("[BLACKSCREEN-PLAYBACK]", payload);
}

/**
 * @param {string} site
 * @returns {number} mount count after increment
 */
export function logBlackscreenMount(site) {
  if (!isBlackscreenTraceEnabled()) return 0;
  if (!mountCounts[site]) mountCounts[site] = { mount: 0, unmount: 0 };
  mountCounts[site].mount += 1;
  if (site === "RootLayout") {
    layoutMountGeneration += 1;
    if (layoutMountGeneration === 1) {
      pushBlackscreenEvent("mount", { site, phase: "root-first-mount" });
    } else {
      dumpBlackscreenRingBuffer("root-layout-remount");
      pushBlackscreenEvent("mount", { site, phase: "root-remount", generation: layoutMountGeneration });
    }
  }
  const payload = {
    site,
    mountCount: mountCounts[site].mount,
    unmountCount: mountCounts[site].unmount,
    timestamp: ts(),
  };
  pushBlackscreenEvent("mount", { ...payload, phase: "mount" });
  prefixLog("[BLACKSCREEN-MOUNT]", payload);
  return mountCounts[site].mount;
}

export function logBlackscreenUnmount(site) {
  if (!isBlackscreenTraceEnabled()) return;
  if (!mountCounts[site]) mountCounts[site] = { mount: 0, unmount: 0 };
  mountCounts[site].unmount += 1;
  if (site === "RootLayout" && mountCounts[site].mount > 0 && mountCounts[site].unmount >= mountCounts[site].mount) {
    dumpBlackscreenRingBuffer("root-layout-unmount");
    layoutMountGeneration = 0;
    mountCounts[site].mount = 0;
    mountCounts[site].unmount = 0;
  }
  const payload = {
    site,
    mountCount: mountCounts[site].mount,
    unmountCount: mountCounts[site].unmount,
    timestamp: ts(),
  };
  pushBlackscreenEvent("mount", { ...payload, phase: "unmount" });
  prefixLog("[BLACKSCREEN-MOUNT]", payload);
}

/**
 * @param {string} kind
 * @param {Record<string, unknown>} [detail]
 */
export function logBlackscreenAuth(kind, detail = {}) {
  if (!isBlackscreenTraceEnabled()) return;
  const payload = {
    kind,
    reason: detail.reason ?? detail.source ?? "",
    timestamp: ts(),
    ...detail,
  };
  pushBlackscreenEvent("auth", payload);
  prefixLog("[BLACKSCREEN-AUTH]", payload);
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} [detail]
 */
export function logBlackscreenLifecycle(event, detail = {}) {
  if (!isBlackscreenTraceEnabled()) return;
  const payload = { event, timestamp: ts(), ...detail };
  pushBlackscreenEvent("lifecycle", payload);
  prefixLog("[BLACKSCREEN-LIFECYCLE]", payload);
}

/**
 * @param {Record<string, unknown>} nav
 */
export function logBlackscreenNav(nav) {
  if (!isBlackscreenTraceEnabled()) return;
  const payload = { timestamp: ts(), ...nav };
  pushBlackscreenEvent("nav", payload);
  prefixLog("[BLACKSCREEN-NAV]", payload);
}

/**
 * @param {Record<string, unknown>} scroll
 */
export function logBlackscreenScrollReset(scroll) {
  if (!isBlackscreenTraceEnabled()) return;
  const payload = { timestamp: ts(), ...scroll };
  pushBlackscreenEvent("scroll", payload);
  prefixLog("[BLACKSCREEN-SCROLLRESET]", payload);
}

function logBlackscreenError(kind, detail) {
  const payload = { kind, timestamp: ts(), ...detail };
  pushBlackscreenEvent("error", payload);
  prefixLog("[BLACKSCREEN-ERROR]", payload);
  dumpBlackscreenRingBuffer(kind);
}

function getMainScrollElement() {
  if (typeof document === "undefined") return null;
  return document.querySelector("[data-main-scroll]");
}

function sampleScrollPositions() {
  const mainEl = getMainScrollElement();
  const windowY = typeof window !== "undefined" ? window.scrollY : 0;
  const mainTop = mainEl ? mainEl.scrollTop : null;
  return { windowY, mainTop, mainEl: Boolean(mainEl) };
}

function checkScrollReset() {
  if (!isBlackscreenTraceEnabled() || beforeUnloadPending) return;
  const { windowY, mainTop } = sampleScrollPositions();
  const candidates = [
    { target: "window", prev: lastWindowScrollY, next: windowY },
    { target: "main", prev: lastMainScrollTop, next: mainTop },
  ];
  for (const { target, prev, next } of candidates) {
    if (prev == null || next == null) continue;
    if (prev > 200 && next < 20) {
      logBlackscreenScrollReset({
        target,
        previousScroll: prev,
        newScroll: next,
        trigger: "scroll-drop",
      });
    }
  }
  lastWindowScrollY = windowY;
  if (mainTop != null) lastMainScrollTop = mainTop;
}

let scrollListenersAttached = false;

function attachScrollInstrumentation() {
  if (!isBlackscreenTraceEnabled() || scrollListenersAttached) return;
  scrollListenersAttached = true;
  const onScroll = () => checkScrollReset();
  window.addEventListener("scroll", onScroll, { passive: true });
  const mainEl = getMainScrollElement();
  mainEl?.addEventListener("scroll", onScroll, { passive: true });
  const pollId = window.setInterval(checkScrollReset, 500);
  const initial = sampleScrollPositions();
  lastWindowScrollY = initial.windowY;
  lastMainScrollTop = initial.mainTop;
  return () => {
    window.removeEventListener("scroll", onScroll);
    mainEl?.removeEventListener("scroll", onScroll);
    window.clearInterval(pollId);
    scrollListenersAttached = false;
  };
}

let historyPatched = false;

function patchHistoryForNav(getRoute) {
  if (!isBlackscreenTraceEnabled() || historyPatched || typeof window === "undefined") return;
  historyPatched = true;
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);

  history.pushState = function patchedPushState(...args) {
    const prev = getRoute();
    origPush(...args);
    logBlackscreenNav({
      previousRoute: prev,
      newRoute: getRoute(),
      trigger: "history.pushState",
    });
  };

  history.replaceState = function patchedReplaceState(...args) {
    const prev = getRoute();
    origReplace(...args);
    logBlackscreenNav({
      previousRoute: prev,
      newRoute: getRoute(),
      trigger: "history.replaceState",
    });
  };

  window.addEventListener("popstate", () => {
    logBlackscreenNav({
      previousRoute: null,
      newRoute: getRoute(),
      trigger: "popstate",
    });
  });
}

let globalHandlersAttached = false;

/**
 * One-time client instrumentation (idempotent).
 * @param {{ getRoute?: () => string }} [opts]
 */
export function initBlackscreenTrace(opts = {}) {
  if (!isBlackscreenTraceEnabled() || typeof window === "undefined") return () => {};
  if (initialized) return () => {};
  initialized = true;

  const getRoute =
    opts.getRoute ||
    (() => {
      if (typeof window === "undefined") return "";
      const { pathname, search } = window.location;
      return `${pathname}${search}`;
    });

  const prevOnError = window.onerror;
  window.onerror = function blackscreenOnError(message, url, line, column, error) {
    logBlackscreenError("window.onerror", {
      message: String(message ?? ""),
      stack: error?.stack ?? null,
      url: url ?? null,
      line: line ?? null,
      column: column ?? null,
    });
    if (typeof prevOnError === "function") {
      return prevOnError.call(this, message, url, line, column, error);
    }
    return false;
  };

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    logBlackscreenError("unhandledrejection", {
      message: reason?.message ? String(reason.message) : String(reason ?? ""),
      stack: reason?.stack ?? null,
      reason: reason ?? null,
    });
  });

  const lifecycleEvents = [
    "visibilitychange",
    "pagehide",
    "pageshow",
    "beforeunload",
    "freeze",
    "resume",
    "online",
    "offline",
  ];

  for (const eventName of lifecycleEvents) {
    const target = eventName === "visibilitychange" ? document : window;
    target.addEventListener(eventName, () => {
      if (eventName === "beforeunload") beforeUnloadPending = true;
      const detail = { event: eventName };
      if (eventName === "visibilitychange") {
        detail.visibilityState = document.visibilityState;
      }
      logBlackscreenLifecycle(eventName, detail);
    });
  }

  window.addEventListener("entitlements:updated", (event) => {
    const d = event?.detail || {};
    logBlackscreenAuth("entitlements:updated", {
      reason: d.reason || d.source || "event",
      source: d.source,
    });
  });

  patchHistoryForNav(getRoute);
  scrollTeardown = attachScrollInstrumentation() ?? null;

  pushBlackscreenEvent("init", { timestamp: ts() });
  prefixLog("[BLACKSCREEN-LIFECYCLE]", { event: "blackscreen-trace-init", timestamp: ts() });

  return () => {
    scrollTeardown?.();
    scrollTeardown = null;
    initialized = false;
  };
}

export function getBlackscreenRingBuffer() {
  return ringBuffer.slice();
}
