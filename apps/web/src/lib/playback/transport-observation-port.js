/**
 * Dependency-inversion seam between physical/legacy playback and Playback Core.
 *
 * This module intentionally imports no Core internals and no media engine. The
 * production wiring injects one authority sink; physical producers submit typed
 * facts through it. When no sink is installed, writes fail closed.
 */

export const TRANSPORT_OBSERVATION = Object.freeze({
  EXECUTION_LOADING:  "EXECUTION_LOADING",
  EXECUTION_RESULT:   "EXECUTION_RESULT",
  PHYSICAL_PLAY:      "PHYSICAL_PLAY",
  PHYSICAL_PLAYING:   "PHYSICAL_PLAYING",
  PHYSICAL_PAUSE:     "PHYSICAL_PAUSE",
  PHYSICAL_WAITING:   "PHYSICAL_WAITING",
  PHYSICAL_STALLED:   "PHYSICAL_STALLED",
  PHYSICAL_CANPLAY:   "PHYSICAL_CANPLAY",
  PHYSICAL_SEEKING:   "PHYSICAL_SEEKING",
  PHYSICAL_SEEKED:    "PHYSICAL_SEEKED",
  PHYSICAL_ENDED:     "PHYSICAL_ENDED",
  PHYSICAL_ERROR:     "PHYSICAL_ERROR",
  RECOVERY_STARTED:   "RECOVERY_STARTED",
  RECOVERY_COMPLETED: "RECOVERY_COMPLETED",
  RECOVERY_FAILED:    "RECOVERY_FAILED",
  LEGACY_PROJECTION:  "LEGACY_PROJECTION",
});

const EMPTY_STATUS = Object.freeze({
  status: "IDLE", playing: false, paused: false, loading: false,
  buffering: false, seeking: false, ended: false, recovering: false,
  degraded: false, error: null, networkState: "idle", readiness: "EMPTY",
  mediaIdentity: null, desiredRevision: 0,
});
const EMPTY_TIMELINE = Object.freeze({
  position: 0, duration: 0, bufferedEnd: 0, mediaIdentity: null,
  desiredRevision: 0, observedAt: 0, presentedAt: 0,
});
const EMPTY_MODE = Object.freeze({ volume: 1, playbackRate: 1 });

let installed = null;
const physicalContexts = new WeakMap();

export function installTransportObservationSink(sink) {
  if (!sink || typeof sink.observe !== "function") {
    throw new TypeError("[TransportBridge] a complete observation sink is required");
  }
  const installation = Symbol("transport-sink");
  installed = { installation, ...sink };
  return () => {
    if (installed?.installation === installation) installed = null;
  };
}

export function captureTransportObservationContext(meta = {}) {
  return installed?.captureContext?.(meta) ?? null;
}

/** Bind the authority captured at a physical effect to its eventual DOM fact. */
export function markPhysicalObservationContext(element, eventType, context) {
  if (!element || !eventType || !context) return;
  let byType = physicalContexts.get(element);
  if (!byType) {
    byType = new Map();
    physicalContexts.set(element, byType);
  }
  byType.set(eventType, context);
}

/** Consume-once prevents a token from authorizing more than its matching fact. */
export function takePhysicalObservationContext(element, eventType) {
  const byType = element ? physicalContexts.get(element) : null;
  const context = byType?.get(eventType) ?? null;
  byType?.delete(eventType);
  return context;
}

export function reportTransportObservation(type, payload = {}, context = null) {
  if (!installed) return { accepted: false, rejectionReason: "TRANSPORT_AUTHORITY_UNAVAILABLE" };
  return installed.observe(type, payload, context ?? installed.captureContext(payload));
}

export function reportTransportTimeline(payload = {}, context = null, options = {}) {
  if (!installed) return { accepted: false, rejectionReason: "TRANSPORT_AUTHORITY_UNAVAILABLE" };
  return installed.observeTimeline(payload, context ?? installed.captureContext(payload), options);
}

export function reportTransportMode(payload = {}, context = null) {
  if (!installed) return { accepted: false, rejectionReason: "TRANSPORT_AUTHORITY_UNAVAILABLE" };
  return installed.observeMode(payload, context ?? installed.captureContext(payload));
}

export function getCanonicalTransportStatus() {
  return installed?.getStatusSnapshot?.() ?? EMPTY_STATUS;
}

export function getCanonicalTransportTimeline() {
  return installed?.getTimelineSnapshot?.() ?? EMPTY_TIMELINE;
}

export function getCanonicalTransportMode() {
  return installed?.getModeSnapshot?.() ?? EMPTY_MODE;
}

export function subscribeCanonicalTransportStatus(listener) {
  return installed?.subscribeStatus?.(listener) ?? (() => {});
}

export function subscribeCanonicalTransportTimeline(listener) {
  return installed?.subscribeTimeline?.(listener) ?? (() => {});
}

export function subscribeCanonicalTransportMode(listener) {
  return installed?.subscribeMode?.(listener) ?? (() => {});
}

export function getTransportAuthorityMetrics() {
  return installed?.getMetrics?.() ?? Object.freeze({
    observations: 0, accepted: 0, rejected: 0,
    timelineObservations: 0, timelineCommits: 0,
  });
}
