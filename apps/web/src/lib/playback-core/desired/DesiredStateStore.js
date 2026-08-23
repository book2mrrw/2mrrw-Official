/**
 * DesiredStateStore — the single holder of canonical DESIRED execution state.
 *
 * Exactly one writer: apply(). The revision is monotonically increasing and
 * Core-owned, in the same spirit as IntentSequencer.sequence but tracking a
 * different dimension:
 *
 *   sequence        → ordering of user INTENTS
 *   desiredRevision → versions of what the user WANTS
 *   commitVersion   → versions of what canonical state has ACCEPTED
 *
 * Revision only advances when the reducer actually changes the state, so
 * out-of-scope intents imply no convergence work.
 */

import { initialDesiredExecutionState } from "./DesiredExecutionState.js";
import { reduceDesiredState }           from "./DesiredStateReducer.js";

export class DesiredStateStore {
  #state = initialDesiredExecutionState();
  #listeners = new Set();
  #logger;

  constructor({ logger } = {}) {
    this.#logger = logger;
  }

  /** Current frozen desired state. */
  get current() { return this.#state; }

  /** Current desired revision (monotonic, Core-owned). */
  get revision() { return this.#state.revision; }

  /**
   * Apply an intent through the reducer.
   *
   * @param {import('../intents/IntentFactory.js').PlaybackIntent} intent
   * @returns {{ changed: boolean, state: object }}
   */
  apply(intent) {
    const prev = this.#state;
    const next = reduceDesiredState(prev, intent);
    if (next === prev) return { changed: false, state: prev };

    this.#state = next;
    this.#logger?.emit({
      type:            "DESIRED_STATE_REVISED",
      revision:        next.revision,
      intentId:        intent.intentId ?? null,
      commandType:     intent.type,
      mediaIdentity:   next.requestedMediaIdentity,
      transport:       next.desiredTransport,
      positionTarget:  next.positionTarget,
    });

    for (const fn of this.#listeners) {
      try { fn(next, prev); }
      catch (err) {
        // eslint-disable-next-line no-console
        console.error("[PlaybackCore:DesiredStateStore] listener error:", err);
      }
    }
    return { changed: true, state: next };
  }

  /**
   * Subscribe to desired-state revisions.
   * @param {(next: object, prev: object) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("DesiredStateStore.subscribe: fn must be a function");
    }
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}
