/**
 * IntentSequencer — owns sessionEpoch and the monotonic sequence counter.
 *
 * INVARIANTS (locked):
 *   • sessionEpoch is generated once at construction and never changes.
 *   • sequence is monotonically increasing within one Core lifecycle.
 *   • JWT refresh, login, logout, auth refresh, or capability change must
 *     NEVER call any method on this class — they have no effect on the epoch.
 *   • Only destroying and creating a new PlaybackCore resets these values.
 *
 * intentId format:  "<sessionEpoch>:<sequence>"
 *   sessionEpoch — UUID (128-bit cryptographically random), unique per Core instance.
 *   sequence     — cheap numeric comparison for authority checks.
 *   intentId     — durable diagnostic identity usable in logs, traces, CI output.
 *
 * Collision probability: 1/2^122 (UUID v4 entropy — negligible).
 * Math.random() fallback is REJECTED — cryptographic strength is non-negotiable.
 * If crypto.randomUUID is unavailable, construction throws so the caller is aware.
 */

export class IntentSequencer {
  #epoch;
  #sequence;

  constructor() {
    this.#epoch = IntentSequencer.#generateEpoch();
    this.#sequence = 0;
  }

  /** Stable epoch for this Core instance's lifetime. Never changes. */
  get sessionEpoch() {
    return this.#epoch;
  }

  /** Current highest issued sequence number. */
  get currentSequence() {
    return this.#sequence;
  }

  /**
   * Issue the next intent identity.
   * @returns {{ sequence: number, intentId: string }}
   */
  next() {
    this.#sequence += 1;
    return {
      sequence: this.#sequence,
      intentId: `${this.#epoch}:${this.#sequence}`,
    };
  }

  /** Generate a 128-bit cryptographically-random epoch via crypto.randomUUID(). */
  static #generateEpoch() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    throw new Error(
      "[IntentSequencer] crypto.randomUUID() is unavailable. " +
      "PlaybackCore requires a cryptographically secure runtime (Node ≥ 19, modern browser). " +
      "Math.random() fallback is rejected — epoch strength is non-negotiable."
    );
  }
}
