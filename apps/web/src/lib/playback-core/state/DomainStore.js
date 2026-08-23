/**
 * DomainStore — framework-independent state container with independent
 * subscription channels.
 *
 * INVARIANTS (locked):
 *   • Each domain store has its OWN version counter and subscriber set.
 *   • A commit to domain A MUST NOT notify subscribers of domain B.
 *   • Snapshots returned by getSnapshot() are DEEPLY FROZEN — callers cannot
 *     mutate canonical state through a returned reference at any depth.
 *   • External references passed to _applyCommit() cannot mutate canonical
 *     state after commit (structuredClone breaks all shared references).
 *   • Unchanged domains retain their previous snapshot identity (===),
 *     which is essential for useSyncExternalStore selector stability.
 *   • _applyCommit() is package-internal: only CommitGate calls it.
 *
 * This class has no React dependency and no browser dependency.
 * It can be constructed and tested in plain Node.js.
 */

export class DomainStore {
  #name;
  #snapshot;
  #version;
  #listeners;

  /**
   * Recursively freeze an object and all nested objects/arrays in place.
   * Uses a WeakSet to detect and skip cyclic references — structuredClone
   * preserves cycles in its output, so deepFreeze must be cycle-safe.
   */
  static #deepFreeze(val, seen = new WeakSet()) {
    if (val === null || typeof val !== "object") return val;
    if (seen.has(val)) return val;   // cycle detected — already being processed
    seen.add(val);
    for (const key of Object.getOwnPropertyNames(val)) {
      DomainStore.#deepFreeze(val[key], seen);
    }
    return Object.freeze(val);
  }

  /**
   * Return a fully isolated, deeply frozen copy of snapshot.
   * Requires structuredClone — fails explicitly if unavailable.
   * JSON.parse(JSON.stringify(...)) is permanently rejected: it is lossy
   * (destroys undefined, Date, Map, Set, BigInt, typed values) and the Core
   * fails closed rather than silently corrupting canonical state.
   */
  static #immuteCopy(snapshot) {
    if (typeof structuredClone !== "function") {
      throw new Error(
        "[DomainStore] structuredClone() is unavailable. " +
        "PlaybackCore requires a trustworthy structured-clone implementation. " +
        "JSON.parse(JSON.stringify(...)) is lossy and permanently rejected — " +
        "the Core fails closed rather than silently corrupting canonical state."
      );
    }
    return DomainStore.#deepFreeze(structuredClone(snapshot));
  }

  /**
   * @param {string} name            - domain name, for diagnostics
   * @param {object} initialSnapshot - initial state (will be deep-frozen clone)
   */
  constructor(name, initialSnapshot) {
    if (!name) throw new TypeError("DomainStore: name is required");
    this.#name = name;
    this.#snapshot = DomainStore.#immuteCopy(initialSnapshot);
    this.#version = 0;
    this.#listeners = new Set();
  }

  /** Domain name — stable, for diagnostics. */
  get name() {
    return this.#name;
  }

  /**
   * Current version number. Increments by 1 on every _applyCommit().
   * Unchanged domains keep the same version. Used by React adapter to
   * detect whether a re-render is needed.
   */
  get version() {
    return this.#version;
  }

  /**
   * Returns the current immutable snapshot.
   * The returned reference is frozen — mutation attempts throw in strict mode.
   * The reference is STABLE between commits: same object === until _applyCommit().
   *
   * @returns {Readonly<object>}
   */
  getSnapshot() {
    return this.#snapshot;
  }

  /**
   * Subscribe to this domain's changes.
   * The listener is called with (snapshot, version) after every commit.
   * Returns an unsubscribe function.
   *
   * @param {(snapshot: Readonly<object>, version: number) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("DomainStore.subscribe: listener must be a function");
    }
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Apply a new state snapshot to this domain.
   *
   * INTERNAL — only CommitGate may call this. Calling from anywhere else
   * bypasses the AuthorityGate and violates Invariant 2.
   *
   * @param {object} snapshot - new state (deep-cloned + deep-frozen)
   */
  _applyCommit(snapshot) {
    this.#snapshot = DomainStore.#immuteCopy(snapshot);
    this.#version += 1;
    const v = this.#version;
    const s = this.#snapshot;
    for (const listener of this.#listeners) {
      try {
        listener(s, v);
      } catch (err) {
        // Listeners must not crash the commit path. Log and continue.
        // eslint-disable-next-line no-console
        console.error(`[PlaybackCore] DomainStore(${this.#name}) listener error:`, err);
      }
    }
  }

  /** Returns the number of active subscribers — for testing. */
  _subscriberCount() {
    return this.#listeners.size;
  }
}
