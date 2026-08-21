/**
 * CoreLogger — structured intent lifecycle event log for 2MRRW Playback Core.
 *
 * Emits events through an internal ring buffer (cap 200) and to pluggable
 * subscribers. In Slice 0 no production code reads these — they exist for
 * testing, debugging, and future diagnostics tooling.
 *
 * No React, no DOM, no browser APIs. Plain JS class, testable in Node.
 *
 * RULES:
 *   - Subscribers must never throw; errors are caught and logged to console.
 *   - The ring buffer never grows past RING_CAPACITY — oldest events are evicted.
 *   - emit() is synchronous: subscribers are called inline.
 *   - No PII, no full track URLs. Only identifiers, types, sequences, timestamps.
 */

import { DiagnosticEventType } from "../types/index.js";

const RING_CAPACITY = 200;

export class CoreLogger {
  #ring = [];
  #ringHead = 0;
  #totalEmitted = 0;
  #subscribers = new Set();
  #enabled;

  /**
   * @param {{ enabled?: boolean }} [opts]
   */
  constructor({ enabled = true } = {}) {
    this.#enabled = enabled;
  }

  /**
   * Emit a diagnostic event.
   *
   * @param {object} event - must include a `type` field (DiagnosticEventType constant)
   */
  emit(event) {
    if (!this.#enabled) return;

    const stamped = Object.freeze({
      ...event,
      _seq: ++this.#totalEmitted,
      _ts: Date.now(),
    });

    // Ring buffer: overwrite oldest slot
    this.#ring[this.#ringHead % RING_CAPACITY] = stamped;
    this.#ringHead += 1;

    for (const sub of this.#subscribers) {
      try {
        sub(stamped);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[PlaybackCore:CoreLogger] subscriber error:", err);
      }
    }
  }

  /**
   * Subscribe to all future events.
   * Returns an unsubscribe function.
   *
   * @param {(event: object) => void} fn
   * @returns {() => void}
   */
  subscribe(fn) {
    if (typeof fn !== "function") throw new TypeError("CoreLogger.subscribe: fn must be a function");
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  /**
   * Returns a snapshot of the ring buffer contents in emission order.
   * Oldest first, most recent last.
   *
   * @returns {readonly object[]}
   */
  getHistory() {
    const capacity = RING_CAPACITY;
    const head = this.#ringHead;
    const count = Math.min(head, capacity);

    if (count === 0) return Object.freeze([]);

    const result = [];
    // If buffer hasn't wrapped yet, it's 0..count
    if (head <= capacity) {
      for (let i = 0; i < head; i++) {
        result.push(this.#ring[i]);
      }
    } else {
      // Buffer has wrapped — oldest is at head % capacity
      const start = head % capacity;
      for (let i = 0; i < capacity; i++) {
        result.push(this.#ring[(start + i) % capacity]);
      }
    }

    return Object.freeze(result);
  }

  /** Total number of events ever emitted (not capped by ring). */
  get totalEmitted() {
    return this.#totalEmitted;
  }

  /** Current subscriber count — for testing. */
  get subscriberCount() {
    return this.#subscribers.size;
  }

  enable()  { this.#enabled = true;  }
  disable() { this.#enabled = false; }

  /**
   * Convenience: emit a CORE_INITIALIZED event with Core metadata.
   * @param {{ sessionEpoch: string }} meta
   */
  emitCoreInitialized(meta) {
    this.emit({ type: DiagnosticEventType.CORE_INITIALIZED, sessionEpoch: meta.sessionEpoch });
  }

  /**
   * Convenience: emit a CORE_DESTROYED event.
   * @param {{ sessionEpoch: string }} meta
   */
  emitCoreDestroyed(meta) {
    this.emit({ type: DiagnosticEventType.CORE_DESTROYED, sessionEpoch: meta.sessionEpoch });
  }
}
