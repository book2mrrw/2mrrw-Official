/**
 * ConvergenceEngine — the reconciler. Slice 1C.
 *
 *   USER COMMANDS
 *        │
 *        ▼
 *   DesiredStateReducer  ──►  Canonical Desired State (revision N)
 *        │
 *        ▼
 *   ConvergenceEngine  ──►  legacy dispatch  ──►  Physical Media Runtime
 *
 * TWO-PHASE EXECUTION — and why both phases exist:
 *
 *   PHASE 1 — intent-time dispatch (SYNCHRONOUS, unchanged from Slice 1B)
 *     The mapped legacy command is dispatched in the same synchronous turn as the
 *     user gesture. This is NOT redundant with convergence: it is what preserves
 *     (a) the iOS gesture-activation token, which dies across any await — PLAY and
 *     RESUME are USER_GESTURE_PLAYBACK_COMMANDS; (b) the emergency PAUSE bypass
 *     lane, proven load-bearing at ~130ms during a 5s stalled load; and (c) the
 *     serial queue's natural ordering, which is what makes PLAY→SEEK correct.
 *     Every Slice 1B physical pass depends on this phase.
 *
 *   PHASE 2 — convergence (ASYNCHRONOUS, new in Slice 1C)
 *     Once all in-flight dispatches drain, physical state is compared against the
 *     latest desired revision and corrective steps are issued until they agree.
 *     This is what fixes HB-2: the queued PLAY_TRACK finishes and sets PLAYING,
 *     convergence observes PLAYING ≠ desired PAUSED, and issues the corrective
 *     PAUSE. Self-healing rather than order-dependent.
 *
 * INVARIANTS ENFORCED HERE:
 *   INV-DESIRED-1  Every physical effect is revalidated against the latest
 *                  desired revision AT THE EFFECT BOUNDARY, not only at intent time.
 *   INV-DESIRED-3  Convergence never proceeds toward a stale revision. If the
 *                  revision advances mid-step, the plan is discarded and re-planned.
 *   INV-DESIRED-4  Emergency PAUSE bypasses the EXECUTION QUEUE but not
 *                  DESIRED-STATE AUTHORITY — it still advances the revision first.
 *
 * OWNERSHIP: unchanged. Core owns intent authority + desired state. PSM remains
 * the canonical physical transport authority. Corrections are expressed as legacy
 * commands; Core never writes canonical transport state.
 */

import { TransportDisposition } from "../desired/DesiredExecutionState.js";
import { CoreCommandType, CoreLiveCommandScope } from "../types/index.js";
import { assertProbe } from "./PhysicalStateProbe.js";

/** Seek tolerance in seconds — below this, positions are considered equal. */
const POSITION_TOLERANCE_S = 0.75;

/** Hard ceiling on corrective steps per convergence pass. */
const MAX_STEPS_PER_PASS = 8;

export const ConvergenceStep = Object.freeze({
  LOAD:   "LOAD",
  SEEK:   "SEEK",
  PAUSE:  "PAUSE",
  RESUME: "RESUME",
});

export class ConvergenceEngine {
  #store;
  #adapter;
  #probe;
  #logger;
  #liveScope;

  #inFlight = 0;
  #converging = false;
  #rerunRequested = false;
  #disposed = false;
  #pendingTimer = null;
  /** Desired revision whose positionTarget has already been satisfied by a seek. */
  #seekSettledRevision = null;

  /**
   * @param {object} deps
   * @param {import('../desired/DesiredStateStore.js').DesiredStateStore} deps.desiredStore
   * @param {import('../adapters/PlaybackCoreAdapter.js').PlaybackCoreAdapter} deps.adapter
   * @param {{ snapshot: () => object }} deps.probe
   * @param {import('../diagnostics/CoreLogger.js').CoreLogger} [deps.logger]
   * @param {Set<string>} [deps.liveScope]
   */
  constructor({ desiredStore, adapter, probe, logger, liveScope = CoreLiveCommandScope }) {
    if (!desiredStore) throw new TypeError("[ConvergenceEngine] desiredStore is required");
    if (!adapter)      throw new TypeError("[ConvergenceEngine] adapter is required");
    this.#store     = desiredStore;
    this.#adapter   = adapter;
    this.#probe     = assertProbe(probe);
    this.#logger    = logger;
    this.#liveScope = liveScope;
  }

  /** Current desired revision — convenience for diagnostics and tests. */
  get desiredRevision() { return this.#store.revision; }
  /** True while a convergence pass is running. */
  get isConverging() { return this.#converging; }
  /** Number of dispatches that have not yet settled. */
  get inFlight() { return this.#inFlight; }

  // ─── Execution engine surface (called by CommandGateway) ────────────────────

  /**
   * Handle one authoritative intent.
   *
   * MUST remain synchronous up to and including the phase-1 dispatch. Introducing
   * an await above that line loses the iOS activation token.
   *
   * @param {import('../intents/IntentFactory.js').PlaybackIntent} intent
   * @returns {Promise<any>|null}
   */
  execute(intent) {
    if (!this.#liveScope.has(intent.type)) {
      this.#logger?.emit({
        type: "CORE_ADAPTER_OUT_OF_SCOPE",
        commandType: intent.type,
        intentId: intent.intentId,
      });
      return null;
    }

    // INV-DESIRED-4: authority (the revision bump) is recorded BEFORE any effect,
    // including for emergency PAUSE. Bypassing the queue never bypasses authority.
    const { changed, state } = this.#store.apply(intent);
    if (!changed) return null;

    // PHASE 1 — synchronous intent-time dispatch. Preserves iOS gesture, the
    // emergency PAUSE lane, and serial-queue ordering.
    const step = ConvergenceEngine.#stepForIntent(intent, state);
    const promise = step ? this.#dispatchTracked(step, state.revision, "intent") : null;

    // If nothing was dispatched there is no settle callback to trigger phase 2,
    // so schedule it directly.
    if (!promise) this.#scheduleConverge("intent-no-effect");
    return promise;
  }

  // ─── Convergence ────────────────────────────────────────────────────────────

  /**
   * Run a convergence pass now and resolve when physical state agrees with the
   * latest desired revision (or the step ceiling is hit). Exposed for tests and
   * for callers that need to await settlement.
   */
  async converge(reason = "manual") {
    if (this.#disposed) return;
    if (this.#converging) {
      this.#rerunRequested = true;
      return;
    }
    this.#converging = true;
    try {
      for (let i = 0; i < MAX_STEPS_PER_PASS; i++) {
        const revision = this.#store.revision;
        const desired  = this.#store.current;
        const physical = this.#probe.snapshot();
        const step     = this.#planStep(physical, desired);

        if (!step) {
          this.#logger?.emit({
            type: "CONVERGENCE_SETTLED", revision, reason,
            mediaIdentity: physical.mediaIdentity, transport: physical.transport,
          });
          break;
        }

        this.#logger?.emit({
          type: "CONVERGENCE_STEP", revision, reason, step: step.kind,
          from: `${physical.mediaIdentity}/${physical.transport}@${physical.position}`,
          to:   `${desired.requestedMediaIdentity}/${desired.desiredTransport}@${desired.positionTarget ?? "-"}`,
        });

        await this.#dispatchTracked(step, revision, "convergence");

        // INV-DESIRED-3: if the user changed their mind mid-step, discard the
        // plan and re-plan against the newer revision on the next iteration.
        if (this.#store.revision !== revision) continue;
      }
    } finally {
      this.#converging = false;
      if (this.#rerunRequested) {
        this.#rerunRequested = false;
        await this.converge("rerun");
      }
    }
  }

  /**
   * Decide the single next corrective step, or null when already converged.
   * Order matters: identity first, then position, then disposition — a seek or a
   * transport change against the wrong media is exactly the bug class Slice 1B found.
   */
  #planStep(physical, desired) {
    if (!desired.requestedMediaIdentity) return null;

    if (physical.mediaIdentity !== desired.requestedMediaIdentity) {
      return { kind: ConvergenceStep.LOAD, entry: desired.requestedMediaEntry, resumePolicy: desired.resumePolicy };
    }

    if (
      desired.positionTarget != null &&
      this.#seekSettledRevision !== desired.revision &&
      Math.abs(physical.position - desired.positionTarget) > POSITION_TOLERANCE_S
    ) {
      return { kind: ConvergenceStep.SEEK, position: desired.positionTarget };
    }

    if (desired.desiredTransport === TransportDisposition.PAUSED &&
        physical.transport === TransportDisposition.PLAYING) {
      return { kind: ConvergenceStep.PAUSE };
    }

    if (desired.desiredTransport === TransportDisposition.PLAYING &&
        physical.transport === TransportDisposition.PAUSED) {
      return { kind: ConvergenceStep.RESUME };
    }

    return null;
  }

  /**
   * Dispatch a step, revalidating the desired revision at the effect boundary.
   * Tracks in-flight count so convergence runs only once everything has settled.
   */
  #dispatchTracked(step, revisionAtPlan, origin) {
    if (this.#disposed) return Promise.resolve(null);
    // INV-DESIRED-1 / INV-DESIRED-3 — effect-boundary revalidation.
    if (this.#store.revision !== revisionAtPlan) {
      this.#logger?.emit({
        type: "CONVERGENCE_STEP_SKIPPED_STALE",
        step: step.kind, plannedRevision: revisionAtPlan,
        currentRevision: this.#store.revision, origin,
      });
      return Promise.resolve(null);
    }

    if (step.kind === ConvergenceStep.SEEK) this.#seekSettledRevision = revisionAtPlan;

    this.#inFlight += 1;
    const settled = Promise.resolve(this.#adapter.dispatchStep(step))
      .catch((err) => {
        this.#logger?.emit({
          type: "CONVERGENCE_STEP_ERROR", step: step.kind, error: err?.message ?? String(err),
        });
        return null;
      })
      .finally(() => {
        this.#inFlight -= 1;
        if (this.#inFlight === 0) this.#scheduleConverge(`${origin}-settled`);
      });
    return settled;
  }

  /** Queue a convergence pass on a macrotask so bursts coalesce into one pass. */
  #scheduleConverge(reason) {
    if (this.#disposed || this.#pendingTimer) return;
    this.#pendingTimer = setTimeout(() => {
      this.#pendingTimer = null;
      void this.converge(reason);
    }, 0);
    // Never hold the process open purely for a convergence tick.
    this.#pendingTimer?.unref?.();
  }

  /**
   * Stop this engine permanently. After dispose() no further convergence passes
   * run and no further effects are dispatched.
   *
   * Required because a Core instance that is replaced (tests, HMR) would
   * otherwise leave an orphaned reconciler still driving the shared media
   * runtime toward a stale desired state.
   */
  dispose() {
    this.#disposed = true;
    this.#rerunRequested = false;
    if (this.#pendingTimer) {
      clearTimeout(this.#pendingTimer);
      this.#pendingTimer = null;
    }
  }

  /** Phase-1 step for an intent — the direct, order-preserving translation. */
  static #stepForIntent(intent, state) {
    switch (intent.type) {
      case CoreCommandType.PLAY:
        return { kind: ConvergenceStep.LOAD, entry: state.requestedMediaEntry, resumePolicy: state.resumePolicy };
      case CoreCommandType.PAUSE:
        return { kind: ConvergenceStep.PAUSE };
      case CoreCommandType.RESUME:
        return { kind: ConvergenceStep.RESUME };
      case CoreCommandType.SEEK:
        return { kind: ConvergenceStep.SEEK, position: state.positionTarget };
      default:
        return null;
    }
  }
}
