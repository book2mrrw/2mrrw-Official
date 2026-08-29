/**
 * AuthorityGate — the correctness mechanism that separates execution
 * cancellation from state-commit authority.
 *
 * CRITICAL ARCHITECTURAL DISTINCTION (locked):
 *   AbortController cancels async work (network, timers).
 *   AuthorityGate cancels the RIGHT TO COMMIT canonical state.
 *   These are NOT the same thing and must never be conflated.
 *
 * A superseded intent may continue executing (e.g., a network request that
 * cannot be physically aborted in time). It will complete its async work.
 * But when it reaches the CommitGate it will be structurally incapable of
 * writing to any canonical state domain, because AuthorityGate.isAuthoritative()
 * will return false.
 *
 * Invariant 10 (locked):
 *   At most one playback intent is authoritative at any instant.
 *
 * Invariant 1 (locked):
 *   A superseded playback intent can never mutate committed playback state.
 *
 * Only PlaybackCore / CommandGateway call register().
 * CommitGate calls isAuthoritative() at the commit boundary.
 * No other code should hold a reference to this gate.
 */

export class AuthorityGate {
  #authoritativeSequence = 0;
  #authoritativeIntentId = null;
  #totalRegistered = 0;
  #authoritativeIntent = null;

  /**
   * Register a new intent as the sole authority.
   * All previously registered intents are immediately superseded.
   *
   * Must be called by CommandGateway immediately after IntentFactory.create().
   * Must be called with monotonically increasing sequence values.
   *
   * @param {import('../intents/IntentFactory.js').PlaybackIntent} intent
   */
  register(intent) {
    if (!intent || typeof intent.sequence !== "number") {
      throw new TypeError("AuthorityGate.register: intent must have a numeric sequence");
    }
    if (intent.sequence <= this.#authoritativeSequence && this.#totalRegistered > 0) {
      throw new RangeError(
        `AuthorityGate.register: sequence ${intent.sequence} is not greater than ` +
        `current authoritative sequence ${this.#authoritativeSequence}. ` +
        `IntentSequencer must always produce monotonically increasing values.`
      );
    }
    this.#authoritativeSequence = intent.sequence;
    this.#authoritativeIntentId = intent.intentId;
    this.#authoritativeIntent = intent;
    this.#totalRegistered += 1;
  }

  /**
   * Answer: is this intent still the sole authority?
   *
   * Called by CommitGate at the exact commit boundary.
   * This is the permanent correctness gate — a "yes" here is the only
   * thing that allows canonical state to change.
   *
   * @param {import('../intents/IntentFactory.js').PlaybackIntent} intent
   * @returns {boolean}
   */
  isAuthoritative(intent) {
    if (!intent || typeof intent.sequence !== "number") return false;
    return intent.sequence === this.#authoritativeSequence;
  }

  /** The sequence number of the currently authoritative intent. */
  get authoritativeSequence() {
    return this.#authoritativeSequence;
  }

  /** The intentId of the currently authoritative intent (for diagnostics). */
  get authoritativeIntentId() {
    return this.#authoritativeIntentId;
  }

  /** Frozen intent currently holding commit authority. Read-only. */
  get authoritativeIntent() {
    return this.#authoritativeIntent;
  }

  /** Total number of intents ever registered (for diagnostics). */
  get totalRegistered() {
    return this.#totalRegistered;
  }

  /** True if any intent has been registered yet. */
  get hasAuthority() {
    return this.#totalRegistered > 0;
  }
}
