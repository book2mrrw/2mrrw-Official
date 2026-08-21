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
 *   sessionEpoch — 8 hex chars, unique per Core instance, diagnostic-friendly.
 *   sequence     — cheap numeric comparison for authority checks.
 *   intentId     — durable diagnostic identity usable in logs, traces, CI output.
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

  /** Generate a cryptographically-random 8-hex-char epoch string. */
  static #generateEpoch() {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0].toString(16).padStart(8, "0");
    }
    // Fallback for environments without Web Crypto (older Node, workers, etc.)
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  }
}
