/**
 * PlaybackPort — the permanent public API surface for all playback commands.
 *
 * This interface is the stable boundary that all UI, adapters, and integrations
 * depend on. It never exposes intentId, sequence, sessionEpoch, AuthorityGate,
 * CommitGate, DomainStore, or any internal Core concept.
 *
 * RULES (locked by architecture spec):
 *   1. UI never constructs intents. PlaybackPort + CommandGateway construct them.
 *   2. No internal Core type leaks through this boundary.
 *   3. All methods are fire-and-forget from the caller's perspective.
 *      (Async execution is handled by the pipeline internally.)
 *   4. Method signatures are stable across all 13 migration slices.
 *      Adding parameters to a new slice is additive with default values.
 *   5. This class has no React dependency.
 *
 * READINESS GUARD (Slice 1):
 *   All command methods fail explicitly if the execution adapter is not yet
 *   injected (Core is CONSTRUCTING). `isReady` is provided by PlaybackCore
 *   as a closure over its internal readiness state. When `isReady` is not
 *   provided (standalone port construction in tests), the guard is disabled.
 *   No silent drops — ever.
 */

import { CoreCommandType, ResumePolicy } from "../types/index.js";

export class PlaybackPort {
  #commandGateway;
  #isReady;

  /**
   * @param {import('../commands/CommandGateway.js').CommandGateway} commandGateway
   * @param {(() => boolean)|null} [isReady]  — returns true when Core is READY.
   *   Omit (or pass null) for standalone port construction (tests, Slice 0).
   *   In that mode the guard is disabled and all commands are accepted.
   */
  constructor(commandGateway, isReady = null) {
    this.#commandGateway = commandGateway;
    this.#isReady = isReady;
  }

  /**
   * Throw if the execution adapter is not yet wired (Core is CONSTRUCTING).
   * Disabled when `isReady` was not provided (backward compat for standalone tests).
   */
  #assertReady(methodName) {
    if (this.#isReady && !this.#isReady()) {
      throw new Error(
        `[PlaybackPort.${methodName}] Core is not READY. ` +
        "Inject an execution adapter via _injectExecutionEngine() before dispatching commands."
      );
    }
  }

  /**
   * Begin playback of a specific track, optionally within a queue context.
   *
   * @param {object} params
   * @param {string}  params.trackId
   * @param {string}  [params.resumePolicy]   - ResumePolicy constant
   * @param {Array}   [params.queueEntries]   - full queue if setting a new context
   * @param {number}  [params.queueIndex]     - index of trackId within queueEntries
   * @param {string}  [params.source]         - "user" | "system" | "autoplay"
   */
  play({ trackId, resumePolicy = ResumePolicy.RESUME_IF_AVAILABLE, queueEntries, queueIndex, options, source = "user" } = {}) {
    this.#assertReady("play");
    this.#commandGateway.dispatch(
      CoreCommandType.PLAY,
      { trackId, resumePolicy, queueEntries, queueIndex, options },
      source,
    );
  }

  /**
   * Pause current playback. No-op if already paused.
   *
   * @param {{ source?: string }} [params]
   */
  pause({ source = "user" } = {}) {
    this.#assertReady("pause");
    this.#commandGateway.dispatch(CoreCommandType.PAUSE, {}, source);
  }

  /**
   * Resume from a paused state. No-op if already playing.
   *
   * @param {{ source?: string }} [params]
   */
  resume({ source = "user" } = {}) {
    this.#assertReady("resume");
    this.#commandGateway.dispatch(CoreCommandType.RESUME, {}, source);
  }

  /**
   * Seek to an absolute position within the current track.
   *
   * @param {object} params
   * @param {number}  params.positionSeconds - must be ≥ 0
   * @param {string}  [params.source]
   */
  seek({ positionSeconds, source = "user" } = {}) {
    this.#assertReady("seek");
    if (typeof positionSeconds !== "number" || positionSeconds < 0) {
      throw new TypeError("PlaybackPort.seek: positionSeconds must be a non-negative number");
    }
    this.#commandGateway.dispatch(CoreCommandType.SEEK, { positionSeconds }, source);
  }

  /**
   * Advance to the next track in the queue.
   *
   * @param {{ source?: string }} [params]
   */
  next({ source = "user" } = {}) {
    this.#assertReady("next");
    this.#commandGateway.dispatch(CoreCommandType.NEXT, {}, source);
  }

  /**
   * Return to the previous track in the queue.
   *
   * @param {{ source?: string }} [params]
   */
  previous({ source = "user" } = {}) {
    this.#assertReady("previous");
    this.#commandGateway.dispatch(CoreCommandType.PREVIOUS, {}, source);
  }

  /**
   * Replace the current queue entirely.
   *
   * @param {object} params
   * @param {Array}   params.queueEntries   - ordered array of queue entry objects
   * @param {number}  [params.queueIndex]   - index to start from (default: 0)
   * @param {string}  [params.source]
   */
  setQueue({ queueEntries, queueIndex = 0, source = "user" } = {}) {
    this.#assertReady("setQueue");
    if (!Array.isArray(queueEntries)) {
      throw new TypeError("PlaybackPort.setQueue: queueEntries must be an array");
    }
    this.#commandGateway.dispatch(CoreCommandType.SET_QUEUE, { queueEntries, queueIndex }, source);
  }

  /**
   * Reorder the queue by moving one entry from fromIndex to toIndex.
   *
   * @param {object} params
   * @param {number}  params.fromIndex
   * @param {number}  params.toIndex
   * @param {string}  [params.source]
   */
  reorderQueue({ fromIndex, toIndex, source = "user" } = {}) {
    this.#assertReady("reorderQueue");
    if (typeof fromIndex !== "number" || typeof toIndex !== "number") {
      throw new TypeError("PlaybackPort.reorderQueue: fromIndex and toIndex must be numbers");
    }
    this.#commandGateway.dispatch(CoreCommandType.REORDER_QUEUE, { fromIndex, toIndex }, source);
  }
}
