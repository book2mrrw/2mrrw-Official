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

/** @type {((payload: Record<string, unknown>) => void) | null} */
let blackscreenPlaybackCorrelation = null;

/**
 * Phase 13 — optional black-screen playback correlation (diagnostics only).
 * @param {((payload: Record<string, unknown>) => void) | null} listener
 */
export function registerBlackscreenPlaybackCorrelation(listener) {
  blackscreenPlaybackCorrelation = listener;
}

/**
 * @param {string} commandType
 * @param {Record<string, unknown>} [meta]
 */
export function correlateBlackscreenPlayback(commandType, meta = {}) {
  if (!blackscreenPlaybackCorrelation) return;
  try {
    blackscreenPlaybackCorrelation({ commandType, ...meta, timestamp: Date.now() });
  } catch {
    /* diagnostics must not throw */
  }
}

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

const INTERNAL_PLAYBACK_FRAME_RE =
  /AudioContext\.(js|jsx)|audio-engine-runtime\.js|playback-trace\.js|dispatchPlaybackCommand|executePlaybackCommand|logDirectInternalCallViolation/;

/**
 * Best-effort caller module from a stack string (Phase 9 authority trace).
 * @param {string | null | undefined} stack
 * @returns {{ module: string; action: string }}
 */
export function parsePlaybackCallerFromStack(stack) {
  if (!stack || typeof stack !== "string") {
    return { module: "unknown", action: "unknown" };
  }
  const lines = stack.split("\n").slice(1);
  for (const line of lines) {
    if (INTERNAL_PLAYBACK_FRAME_RE.test(line)) continue;
    const fileMatch = line.match(/\/([^/]+\.(?:js|jsx|ts|tsx)):\d+/);
    const fnMatch = line.match(/at\s+(?:async\s+)?([^\s(]+)/);
    if (fileMatch) {
      return {
        module: fileMatch[1],
        action: fnMatch?.[1] || line.trim().slice(0, 120),
      };
    }
  }
  const fallback = lines.find((l) => l.trim().startsWith("at "));
  return {
    module: "unknown",
    action: fallback?.trim().slice(0, 120) || "unknown",
  };
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
 * Phase 9 — structured source trace for playback authority audits (dev/trace only).
 *
 * @param {{
 *   module?: string;
 *   action?: string;
 *   reason?: string;
 *   fn?: string;
 * }} meta
 */
export function logPlaybackSourceTrace(meta = {}) {
  if (!isPlaybackTraceEnabled()) return;
  const { module = "unknown", action = "unknown", reason = "unspecified", fn, ...rest } = meta;
  // eslint-disable-next-line no-console
  console.debug("[PLAYBACK-SOURCE-TRACE]", {
    module,
    action,
    reason,
    fn: fn ?? null,
    timestamp: Date.now(),
    ...rest,
  });
}

/**
 * Phase 8/9 — log direct internal playback API use from outside command executor (dev/trace only).
 * Does not block execution.
 *
 * @param {string} internalFn
 * @param {Record<string, unknown>} [extra]
 */
export function logPlaybackAuthViolation(internalFn, extra = {}) {
  if (!isPlaybackTraceEnabled()) return;
  const stack = typeof extra.stack === "string" ? extra.stack : captureStack(8);
  const parsed =
    extra.module && extra.action
      ? { module: String(extra.module), action: String(extra.action) }
      : parsePlaybackCallerFromStack(stack);
  const module = extra.module ?? parsed.module;
  const action = extra.action ?? parsed.action;
  const reason =
    extra.reason ?? "direct_internal_call_outside_command_executor";
  const payload = {
    fn: internalFn,
    module,
    action,
    reason,
    stack,
    timestamp: Date.now(),
    ...extra,
  };
  // eslint-disable-next-line no-console
  console.warn("[PLAYBACK-AUTH-VIOLATION]", payload);
  logPlaybackSourceTrace({
    module,
    action,
    reason,
    fn: internalFn,
    violation: true,
  });
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
 * Phase 10 — engine singleton lifecycle (dev/trace only).
 * @param {Record<string, unknown>} [meta]
 */
export function logPlaybackEngineLifecycle(meta = {}) {
  if (!isPlaybackTraceEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug("[PLAYBACK-ENGINE-LIFECYCLE]", {
    ts: Date.now(),
    ...meta,
  });
}

/**
 * Phase 10 — AudioProvider re-render with no playback state mutation (dev/trace only).
 * @param {Record<string, unknown>} [meta]
 */
export function logPlaybackRenderNoImpact(meta = {}) {
  if (!isPlaybackTraceEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug("[PLAYBACK-RENDER-NO-IMPACT]", {
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

/**
 * Phase 18A — trace when recovery hydration assigns placeholder "Restored" title.
 * @param {{
 *   source: string;
 *   slug?: string | null;
 *   trackId?: string | number | null;
 *   title?: string | null;
 *   extra?: Record<string, unknown>;
 * }} meta
 */
export function logRestoredTitleSource(meta = {}) {
  if (!isPlaybackTraceEnabled()) return;
  const { source, slug = null, trackId = null, title = null, extra = {} } = meta;
  logPlaybackEvent({
    type: "RESTORED_TITLE_SOURCE",
    source,
    trackId: trackId ?? slug,
    extra: { slug, title, ...extra },
  });
}

/**
 * Phase 18C — lifecycle interrupt intent captured before React isPlaying clears.
 * @param {Record<string, unknown>} [meta]
 */
export function logPlaybackIntentCaptured(meta = {}) {
  if (!isPlaybackTraceEnabled()) return;
  logPlaybackEvent({
    type: "PLAYBACK_INTENT_CAPTURED",
    source: meta.source || "onPause",
    trackId: meta.trackId ?? meta.slug ?? null,
    extra: meta,
  });
}

/**
 * Phase 18C — canplay / lifecycle retry armed from captured intent.
 * @param {Record<string, unknown>} [meta]
 */
export function logPlaybackIntentRetry(meta = {}) {
  if (!isPlaybackTraceEnabled()) return;
  logPlaybackEvent({
    type: "PLAYBACK_INTENT_RETRY",
    source: meta.source || "canplay",
    trackId: meta.trackId ?? meta.slug ?? null,
    extra: meta,
  });
}

/**
 * Phase 19 — background / lock-screen continuity trace (NEXT_PUBLIC_PLAYBACK_TRACE gated).
 * @param {string} type
 * @param {Record<string, unknown>} [meta]
 */
export function logBackgroundPlaybackTrace(type, meta = {}) {
  if (!isPlaybackTraceEnabled()) return;
  logPlaybackEvent({
    type,
    source: meta.source || "background",
    trackId: meta.trackId ?? meta.slug ?? null,
    extra: meta,
  });
}

/** @param {Record<string, unknown>} [meta] */
export function logBackgroundPlaybackStopped(meta = {}) {
  logBackgroundPlaybackTrace("BACKGROUND_PLAYBACK_STOPPED", meta);
}

/** @param {Record<string, unknown>} [meta] */
export function logBackgroundAudioContextState(meta = {}) {
  logBackgroundPlaybackTrace("BACKGROUND_AUDIOCONTEXT_STATE", meta);
}

/** @param {Record<string, unknown>} [meta] */
export function logBackgroundMediaSessionState(meta = {}) {
  logBackgroundPlaybackTrace("BACKGROUND_MEDIA_SESSION_STATE", meta);
}

/** @param {Record<string, unknown>} [meta] */
export function logBackgroundAudioElementState(meta = {}) {
  logBackgroundPlaybackTrace("BACKGROUND_AUDIO_ELEMENT_STATE", meta);
}

/** @param {Record<string, unknown>} [meta] */
export function logBackgroundRecoveryTrigger(meta = {}) {
  logBackgroundPlaybackTrace("BACKGROUND_RECOVERY_TRIGGER", meta);
}

/** @param {Record<string, unknown>} [meta] */
export function logBackgroundRecoverySkipped(meta = {}) {
  logBackgroundPlaybackTrace("BACKGROUND_RECOVERY_SKIPPED", meta);
}

/** @param {Record<string, unknown>} [meta] */
export function logLockscreenMediaSessionActive(meta = {}) {
  logBackgroundPlaybackTrace("LOCKSCREEN_MEDIA_SESSION_ACTIVE", meta);
}

/** @param {Record<string, unknown>} [meta] */
export function logPlaybackContinuityLost(meta = {}) {
  logBackgroundPlaybackTrace("PLAYBACK_CONTINUITY_LOST", meta);
}

/** @param {Record<string, unknown>} [meta] */
export function logPlaybackIntentState(meta = {}) {
  logBackgroundPlaybackTrace("PLAYBACK_INTENT_STATE", meta);
}

/** Phase 20C — transport healthy after lifecycle return; recovery suppressed. */
export function logLifecycleTransportHealthy(meta = {}) {
  logBackgroundPlaybackTrace("LIFECYCLE_TRANSPORT_HEALTHY", meta);
}

/** Phase 20C — transport failed; recovery allowed. */
export function logLifecycleTransportFailed(meta = {}) {
  logBackgroundPlaybackTrace("LIFECYCLE_TRANSPORT_FAILED", meta);
}

/** Phase 20C — hard recovery / desync blocked during grace window. */
export function logLifecycleRecoverySuppressed(meta = {}) {
  logBackgroundPlaybackTrace("LIFECYCLE_RECOVERY_SUPPRESSED", meta);
}

/** Phase 20C — recovery not suppressed (genuine failure or grace expired). */
export function logLifecycleRecoveryAllowed(meta = {}) {
  logBackgroundPlaybackTrace("LIFECYCLE_RECOVERY_ALLOWED", meta);
}

/** Phase 20C — user track switch while lifecycle recovery in flight. */
export function logTrackSwitchDuringRecovery(meta = {}) {
  logBackgroundPlaybackTrace("TRACK_SWITCH_DURING_RECOVERY", meta);
}

/** Phase 20C — user track switch shortly after visibility unlock. */
export function logTrackSwitchAfterUnlock(meta = {}) {
  logBackgroundPlaybackTrace("TRACK_SWITCH_AFTER_UNLOCK", meta);
}
