/**
 * PhysicalStateProbe — READ-ONLY observation of actual physical transport state.
 *
 * OWNERSHIP BOUNDARY (critical):
 *   PSM remains the canonical physical/orchestration transport authority. This
 *   probe only READS. Nothing in the convergence path writes canonical transport
 *   state — the ConvergenceEngine expresses corrections as legacy commands and
 *   lets the existing pipeline perform them, exactly as a UI tap would.
 *
 * A probe answers three questions:
 *   - which media is actually loaded right now?
 *   - is it actually playing?
 *   - where is the playhead?
 *
 * @typedef {Object} PhysicalSnapshot
 * @property {string|null} mediaIdentity
 * @property {string}      transport   TransportDisposition
 * @property {number}      position    seconds
 */

import { TransportDisposition } from "../desired/DesiredExecutionState.js";

/**
 * Production probe backed by the audio engine runtime refs.
 *
 * Reads `stateGetterRef` (populated by AudioContext — the same source the legacy
 * diagnostics use) and the live `<audio>` element's currentTime. Both are already
 * public read surfaces; no new coupling is introduced.
 *
 * @param {() => { refs: Record<string, {current: any}> }} getRuntime
 * @returns {{ snapshot: () => PhysicalSnapshot }}
 */
export function createRuntimePhysicalProbe(getRuntime) {
  return {
    snapshot() {
      const refs = getRuntime().refs;
      const state = refs.stateGetterRef.current?.() ?? null;
      const track = state?.currentTrack ?? null;
      const el = refs.audioRef.current ?? null;

      const mediaIdentity =
        track?.id ?? track?.trackId ?? track?.slug ?? null;

      let transport = TransportDisposition.IDLE;
      if (mediaIdentity) {
        transport = state?.isPlaying
          ? TransportDisposition.PLAYING
          : TransportDisposition.PAUSED;
      }

      return {
        mediaIdentity,
        transport,
        position: Number.isFinite(el?.currentTime) ? el.currentTime : 0,
      };
    },
  };
}

/**
 * Wrap any object exposing `snapshot()` and validate its shape once, so a
 * malformed probe fails loudly at wiring time rather than silently producing
 * wrong convergence decisions.
 */
export function assertProbe(probe) {
  if (!probe || typeof probe.snapshot !== "function") {
    throw new TypeError(
      "[PhysicalStateProbe] probe must expose snapshot() -> " +
      "{ mediaIdentity, transport, position }"
    );
  }
  return probe;
}
