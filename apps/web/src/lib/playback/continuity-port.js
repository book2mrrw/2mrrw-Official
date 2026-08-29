/**
 * Dependency-inversion seam between legacy playback/lifecycle code and
 * Playback Core's Continuity authority — mirrors selection-port.js and
 * transport-observation-port.js's shape exactly.
 *
 * This module imports no Core internals. Production wiring installs one
 * authority sink; legacy session-restore/recovery code proposes candidates
 * through it. When no sink is installed, proposals fail closed rather than
 * silently no-opping — a persisted candidate is evidence, never truth, and
 * with no authority available to judge it, the only safe answer is "ignore".
 */

// Legacy candidate-builders need to stamp a schema version without importing
// playback-core directly. This is the one piece of the contract simple
// enough to be a plain constant rather than routed through the installed
// sink — it never changes based on runtime Core state.
export const CONTINUITY_SCHEMA_VERSION = 1;

const EMPTY_CONTINUITY = Object.freeze({
  schemaVersion: null,
  mediaIdentity: null,
  releaseId: null,
  trackId: null,
  savedPositionSeconds: null,
  sessionPositionSeconds: null,
  capturedAt: null,
  validatedAt: null,
});

let installed = null;

export function installContinuityAuthoritySink(sink) {
  if (!sink || typeof sink.proposeSelectionRestore !== "function") {
    throw new TypeError("[ContinuityBridge] a complete authority sink is required");
  }
  const installation = Symbol("continuity-sink");
  installed = { installation, ...sink };
  return () => {
    if (installed?.installation === installation) installed = null;
  };
}

function unavailable() {
  return { accepted: false, rejectionReason: "CONTINUITY_AUTHORITY_UNAVAILABLE" };
}

export function getCanonicalContinuity() {
  return installed?.getSnapshot?.() ?? EMPTY_CONTINUITY;
}

export function subscribeCanonicalContinuity(listener) {
  return installed?.subscribe?.(listener) ?? (() => {});
}

/** Call BEFORE any async candidate-loading work — returns a bundle to hold
 * across the async gap and hand back to `proposeSelectionRestore` unchanged. */
export function beginContinuitySelectionRestore(meta = {}) {
  if (!installed) return null;
  return installed.beginSelectionRestore(meta);
}

export function validateContinuityCandidate(raw) {
  if (!installed) return { ok: false, reason: "CONTINUITY_AUTHORITY_UNAVAILABLE" };
  return installed.validateCandidate(raw);
}

export function proposeContinuitySelectionRestore(candidate, captured) {
  if (!installed) return unavailable();
  return installed.proposeSelectionRestore(candidate, captured);
}

export function validateContinuityPositionRestore(candidate, policy) {
  if (!installed) return unavailable();
  return installed.validatePositionRestore(candidate, policy);
}

export function captureContinuityContext(meta = {}) {
  return installed?.captureContext?.(meta) ?? null;
}

export function clearContinuitySnapshot(context) {
  if (!installed) return unavailable();
  return installed.clearSnapshot(context);
}

export function getContinuityAuthorityMetrics() {
  return installed?.getMetrics?.() ?? Object.freeze({ proposals: 0, accepted: 0, rejected: 0 });
}
