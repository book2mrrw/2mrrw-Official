/**
 * ContinuityAuthority — validates persisted playback candidates and proposes
 * them into the domains that actually own canonical truth. It never becomes
 * canonical authority itself for Selection or Transport (INV-CONT-17):
 *
 *   persisted snapshot -> ContinuityCandidate -> validation -> current Core
 *   authority -> RESTORE_SELECTION / seek-position proposals -> CommitGate /
 *   domain authority -> canonical state
 *
 * RESTORE IS A PROPOSAL. RESTORE IS NEVER AUTHORITY (the governing principle
 * of Slice 4D). Concretely:
 *   - Selection restoration delegates to the ALREADY-CANONICAL
 *     `SelectionAuthority.restoreSelection()` (Slice 3) — this class never
 *     writes queue/nowPlaying/queueIndex itself, and never re-implements
 *     Selection's own staleness check (selectionVersionAtCapture); it adds an
 *     independent CoreEpoch check on top, so a restore surviving Selection's
 *     own gate can still be rejected if the whole runtime was torn down and
 *     replaced in between (INV-CONT-15).
 *   - Position restoration is validated here (media-identity match, minimum
 *     duration, near-end rejection — mirroring the pre-existing legacy
 *     `clampRestorePosition` policy in `audio-element-utils.js`, duplicated
 *     rather than imported so Core stays legacy-independent) but the actual
 *     physical seek still flows through the existing, locked SEEK/resumeAt
 *     pipeline (Slice 1C/2) — this class only decides whether a target
 *     position is safe to hand to that pipeline, never mutates the physical
 *     clock or TransportTimeline itself (INV-CONT-6/7).
 *
 * What THIS class commits, through its own dedicated CommitGate (same
 * one-writer-per-domain pattern as Selection/Transport), is bookkeeping about
 * the last VALIDATED candidate (Domain.CONTINUITY) — never a second canonical
 * copy of Selection or Transport truth.
 */

import { Domain, StoreKey, ContinuityTransitionType as T, CommitRejectionReason } from "../types/index.js";

/** Mirrors the existing legacy restore-position policy in
 * `lib/audio/audio-element-utils.js` (`RESTORE_MIN_POSITION_SEC` /
 * `RESTORE_NEAR_END_BUFFER_SEC`) — duplicated, not imported, so Core stays
 * legacy-independent. Keep these two numbers in sync if that policy changes. */
const RESTORE_MIN_POSITION_SEC = 5;
const RESTORE_NEAR_END_BUFFER_SEC = 3;

function isNearEnd(position, duration) {
  return Number.isFinite(duration) && duration > 0 && position >= duration - RESTORE_NEAR_END_BUFFER_SEC;
}

export class ContinuityAuthority {
  #commitGate;
  #continuityAuthorityGate;
  #coreEpoch;
  #stores;
  #logger;
  #selectionAuthority;
  #sequence = 0;
  #metrics = { proposals: 0, accepted: 0, rejected: 0 };

  constructor({ commitGate, continuityAuthorityGate, coreEpoch, stores, logger, selectionAuthority }) {
    this.#commitGate = commitGate;
    this.#continuityAuthorityGate = continuityAuthorityGate;
    this.#coreEpoch = coreEpoch;
    this.#stores = stores;
    this.#logger = logger;
    this.#selectionAuthority = selectionAuthority;
  }

  get snapshot() {
    return this.#stores.get(StoreKey.CONTINUITY).getSnapshot();
  }

  get metrics() {
    return Object.freeze({ ...this.#metrics });
  }

  subscribe(fn) {
    return this.#stores.get(StoreKey.CONTINUITY).subscribe(fn);
  }

  captureContext(meta = {}) {
    return Object.freeze({
      coreEpoch: this.#coreEpoch.current,
      source: meta.source ?? "unknown",
      requestId: meta.requestId ?? null,
      capturedAt: Date.now(),
    });
  }

  /**
   * Call BEFORE any async work (loading/hydrating a persisted candidate).
   * Bundles a Continuity-level context with a freshly captured Selection
   * context, so the caller can hold ONE object across its async gap and hand
   * it back unchanged to `proposeSelectionRestore` — mirroring exactly how
   * Slice 3's session-restore effect already captures a Selection context
   * before its fetch, now with an added independent CoreEpoch gate.
   */
  beginSelectionRestore(meta = {}) {
    return Object.freeze({
      continuityContext: this.captureContext(meta),
      selectionContext: this.#selectionAuthority.captureContext(meta),
    });
  }

  /**
   * @param {object} candidate - the output of buildContinuityCandidate (must have .selection)
   * @param {{continuityContext: object, selectionContext: object}} captured - from beginSelectionRestore
   */
  proposeSelectionRestore(candidate, captured) {
    this.#metrics.proposals += 1;
    const { continuityContext, selectionContext } = captured ?? {};
    if (!continuityContext || continuityContext.coreEpoch !== this.#coreEpoch.current) {
      return this.#reject(T.PROPOSE_SELECTION_RESTORE, CommitRejectionReason.CONTINUITY_EPOCH_MISMATCH);
    }
    if (!candidate?.selection) {
      return this.#reject(T.PROPOSE_SELECTION_RESTORE, CommitRejectionReason.CONTINUITY_INVALID);
    }

    // Delegation, not authority: SelectionAuthority makes the real decision,
    // including its own independent selectionVersionAtCapture staleness gate
    // (INV-CONT-3). A rejection there is not re-interpreted or retried here.
    const result = this.#selectionAuthority.restoreSelection({
      queue: candidate.selection.queue,
      queueIndex: candidate.selection.queueIndex,
      repeatMode: candidate.selection.repeatMode ?? undefined,
      shuffle: candidate.selection.shuffle,
    }, selectionContext);

    if (!result.accepted) {
      this.#metrics.rejected += 1;
      return { accepted: false, rejectionReason: result.rejectionReason ?? "SELECTION_REJECTED", selectionResult: result };
    }

    this.#metrics.accepted += 1;
    this.#commitRaw(T.COMMIT_SNAPSHOT, {
      ...this.snapshot,
      schemaVersion: candidate.schemaVersion,
      mediaIdentity: candidate.mediaIdentity,
      capturedAt: candidate.persistedAt,
      validatedAt: Date.now(),
    }, continuityContext);

    return { accepted: true, selectionResult: result };
  }

  /**
   * Pure(ish) validation — decides whether a stored position is safe to hand
   * to the existing seek/resumeAt pipeline. Never seeks, never touches
   * TransportTimeline (INV-CONT-6/7) — the physical element remains the only
   * thing that can confirm a seek actually happened.
   *
   * @param {{positionSeconds:number, durationSeconds?:number, mediaIdentity?:string}} candidate
   * @param {{currentMediaIdentity?:string, context?:object}} [policy]
   * @returns {{accepted:boolean, position?:number, rejectionReason?:string}}
   */
  validatePositionRestore(candidate, { currentMediaIdentity, context } = {}) {
    if (context && context.coreEpoch !== this.#coreEpoch.current) {
      return { accepted: false, rejectionReason: CommitRejectionReason.CONTINUITY_EPOCH_MISMATCH };
    }
    const position = candidate?.positionSeconds;
    if (!Number.isFinite(position) || position < RESTORE_MIN_POSITION_SEC) {
      return { accepted: false, rejectionReason: CommitRejectionReason.CONTINUITY_INVALID };
    }
    if (
      candidate.mediaIdentity != null &&
      currentMediaIdentity != null &&
      candidate.mediaIdentity !== currentMediaIdentity
    ) {
      // Selected media has moved on since this position was captured — the
      // position target no longer refers to what is (or would be) playing.
      return { accepted: false, rejectionReason: CommitRejectionReason.CONTINUITY_INVALID };
    }
    const duration = candidate.durationSeconds;
    if (Number.isFinite(duration) && duration > 0) {
      if (isNearEnd(position, duration)) {
        // Documented product policy (matches the pre-existing legacy
        // clampRestorePosition behavior): a position within
        // RESTORE_NEAR_END_BUFFER_SEC of the end is treated as effectively
        // complete — restore is rejected rather than restarting 3s from the
        // end or wrapping to a new track, which is Selection's job, not
        // Continuity's.
        return { accepted: false, rejectionReason: CommitRejectionReason.CONTINUITY_INVALID };
      }
      return { accepted: true, position: Math.min(position, duration - RESTORE_NEAR_END_BUFFER_SEC) };
    }
    return { accepted: true, position };
  }

  /** Explicit clear — e.g. on stopInternal or logout. Always accepted; there
   * is no staleness concern in erasing a candidate. */
  clearSnapshot(context = this.captureContext()) {
    return this.#commitRaw(T.CLEAR_SNAPSHOT, {
      schemaVersion: null,
      mediaIdentity: null,
      releaseId: null,
      trackId: null,
      savedPositionSeconds: null,
      sessionPositionSeconds: null,
      capturedAt: null,
      validatedAt: null,
    }, context);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  #commitRaw(type, snapshot, context) {
    const seq = ++this.#sequence;
    const intent = Object.freeze({ intentId: `continuity:${seq}`, sequence: seq, type });
    this.#continuityAuthorityGate.register(intent);
    return this.#commitGate.propose({
      intent,
      storeKey: StoreKey.CONTINUITY,
      domain: Domain.CONTINUITY,
      snapshot,
      context: { ...context, transitionType: type },
    });
  }

  #reject(type, reason) {
    this.#metrics.rejected += 1;
    this.#logger?.emit({ type: "CONTINUITY_PROPOSAL_REJECTED", transitionType: type, reason });
    return { accepted: false, rejectionReason: reason };
  }
}
