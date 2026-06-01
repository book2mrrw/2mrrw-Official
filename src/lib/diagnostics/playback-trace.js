/**
 * Dev-only playback interruption root-cause trace (Phase 6C).
 * Enable: NODE_ENV=development OR NEXT_PUBLIC_PLAYBACK_TRACE=1
 * Disable: NEXT_PUBLIC_PLAYBACK_TRACE=0
 */

const EXPLICIT_OFF =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_PLAYBACK_TRACE === "0";

const EXPLICIT_ON =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_PLAYBACK_TRACE === "1";

export function isPlaybackTraceEnabled() {
  if (EXPLICIT_OFF) return false;
  if (EXPLICIT_ON) return true;
  return typeof process !== "undefined" && process.env.NODE_ENV === "development";
}

const RING_SIZE = 10;
/** @type {Array<Record<string, unknown>>} */
const playbackEventRing = [];

/** @type {{
 *   lastScrollAt: number;
 *   lastEntitlementUpdateAt: number;
 *   lastRouteChangeAt: number;
 *   lastVisibilityChangeAt: number;
 *   lastVisibilityState: string | null;
 *   lastUiSection: string | null;
 *   lastCatalogRenderAt: number;
 * }} */
const traceContext = {
  lastScrollAt: 0,
  lastEntitlementUpdateAt: 0,
  lastRouteChangeAt: 0,
  lastVisibilityChangeAt: 0,
  lastVisibilityState: null,
  lastUiSection: null,
  lastCatalogRenderAt: 0,
};

export function getPlaybackTraceContext() {
  return { ...traceContext };
}

/**
 * @param {Partial<typeof traceContext>} patch
 */
export function recordPlaybackTraceContext(patch = {}) {
  if (!isPlaybackTraceEnabled()) return;
  Object.assign(traceContext, patch);
}

function captureStack(maxLines = 4) {
  if (typeof Error === "undefined") return null;
  const stack = new Error().stack;
  if (!stack) return null;
  return stack.split("\n").slice(2, 2 + maxLines).join("\n");
}

/**
 * @param {{
 *   type: string;
 *   source?: string;
 *   stack?: string | null;
 *   trackId?: string | number | null;
 *   timestamp?: number;
 *   extra?: Record<string, unknown>;
 * }} event
 */
export function logPlaybackEvent({
  type,
  source = "unknown",
  stack = null,
  trackId = null,
  timestamp = Date.now(),
  extra = {},
}) {
  if (!isPlaybackTraceEnabled()) return;
  const entry = {
    type,
    source,
    stack: stack ?? captureStack(),
    trackId,
    timestamp,
    ...extra,
  };
  playbackEventRing.push(entry);
  while (playbackEventRing.length > RING_SIZE) {
    playbackEventRing.shift();
  }
  // eslint-disable-next-line no-console
  console.debug("[playback-event]", entry);
}

export function getLastPlaybackEvents(count = 5) {
  const n = Math.max(1, Math.min(RING_SIZE, count));
  return playbackEventRing.slice(-n);
}

/**
 * @param {{
 *   trackId?: string | number | null;
 *   queue?: unknown[];
 *   queueIndex?: number;
 *   position?: number;
 *   isPlaying?: boolean;
 *   playbackState?: string | null;
 *   userInitiated?: boolean;
 *   viewportPause?: boolean;
 *   source?: string;
 * }} snapshot
 */
export function capturePlaybackSnapshotOnPause(snapshot = {}) {
  if (!isPlaybackTraceEnabled()) return;
  const payload = {
    trackId: snapshot.trackId ?? null,
    queueLength: Array.isArray(snapshot.queue) ? snapshot.queue.length : 0,
    queueIndex: snapshot.queueIndex ?? -1,
    position: snapshot.position ?? 0,
    isPlaying: Boolean(snapshot.isPlaying),
    playbackState: snapshot.playbackState ?? null,
    userInitiated: Boolean(snapshot.userInitiated),
    viewportPause: Boolean(snapshot.viewportPause),
    source: snapshot.source ?? "audio-pause",
    lastEvents: getLastPlaybackEvents(5),
    traceContext: getPlaybackTraceContext(),
    visibility:
      typeof document !== "undefined" ? document.visibilityState : "unknown",
    route:
      typeof window !== "undefined" ? window.location?.pathname ?? null : null,
    ts: Date.now(),
  };
  // eslint-disable-next-line no-console
  console.debug("[playback-stop-snapshot]", payload);
  return payload;
}

/**
 * Classify unexpected pause (A viewport/focus, B auth/entitlement, C stream/src, D react churn).
 * @param {Record<string, unknown>} evidence
 */
export function classifyPlaybackInterruption(evidence = {}) {
  const ctx = getPlaybackTraceContext();
  const now = Date.now();
  const scores = { A: 0, B: 0, C: 0, D: 0 };
  const ev = [];

  if (evidence.viewportPause) {
    scores.A += 3;
    ev.push("viewportPause flag");
  }
  const recentScroll = ctx.lastScrollAt && now - ctx.lastScrollAt < 800;
  if (recentScroll) {
    scores.A += 2;
    scores.D += 1;
    ev.push(`scroll ${now - ctx.lastScrollAt}ms ago`);
  }
  if (ctx.lastUiSection === "audioVisuals") {
    scores.A += 2;
    ev.push("audioVisuals section active");
  }

  const recentEnt =
    ctx.lastEntitlementUpdateAt && now - ctx.lastEntitlementUpdateAt < 2000;
  if (recentEnt) {
    scores.B += 3;
    ev.push(`entitlement ${now - ctx.lastEntitlementUpdateAt}ms ago`);
  }
  if (evidence.authLoading) {
    scores.B += 2;
    ev.push("authLoading");
  }

  const lastEvents = Array.isArray(evidence.lastEvents) ? evidence.lastEvents : getLastPlaybackEvents(5);
  const streamish = lastEvents.some((e) =>
    /stream|src|abort|replace|preview|upgrade/i.test(String(e?.type || ""))
  );
  if (streamish) {
    scores.C += 3;
    ev.push("recent stream lifecycle events");
  }
  if (evidence.playbackState === "loading" || evidence.playbackState === "preview_fallback") {
    scores.C += 2;
    ev.push(`playbackState=${evidence.playbackState}`);
  }

  const recentCatalog = ctx.lastCatalogRenderAt && now - ctx.lastCatalogRenderAt < 500;
  if (recentCatalog) {
    scores.D += 2;
    ev.push(`catalog render ${now - ctx.lastCatalogRenderAt}ms ago`);
  }
  if (ctx.lastVisibilityChangeAt && now - ctx.lastVisibilityChangeAt < 1500) {
    scores.D += 1;
    scores.A += 1;
    ev.push(`visibility ${ctx.lastVisibilityState} ${now - ctx.lastVisibilityChangeAt}ms ago`);
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [likelyCause, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;
  const confidence =
    topScore === 0 ? "low" : topScore - secondScore >= 2 ? "high" : topScore > 0 ? "medium" : "low";

  const result = { likelyCause, confidence, evidence: ev, scores };
  // eslint-disable-next-line no-console
  console.debug("PLAYBACK INTERRUPTION CLASSIFICATION:", result);
  return result;
}

/**
 * @param {{
 *   renderCount: number;
 *   reasonGuess?: string;
 *   changed?: string[];
 *   deps?: Record<string, unknown>;
 * }} meta
 */
export function logAudioProviderRender(meta = {}) {
  if (!isPlaybackTraceEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug("[render-churn]", {
    scope: "AudioProvider",
    ts: Date.now(),
    ...meta,
  });
}

/**
 * @param {string} kind
 * @param {Record<string, unknown>} [meta]
 */
export function logUiChurn(kind, meta = {}) {
  if (!isPlaybackTraceEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug("[ui-churn]", { kind, ts: Date.now(), ...meta });
}

/**
 * @param {string} phase - start | abort | replace | src-swap | preview-fallback | retry | ready
 * @param {Record<string, unknown>} [meta]
 */
export function logStreamLifecycle(phase, meta = {}) {
  if (!isPlaybackTraceEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug("[stream-lifecycle]", { phase, ts: Date.now(), ...meta });
  logPlaybackEvent({
    type: `stream:${phase}`,
    source: meta.source || "stream-client",
    trackId: meta.slug || meta.trackId || null,
    extra: meta,
  });
}
