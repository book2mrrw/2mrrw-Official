/**
 * DomainStore — framework-independent state container with independent
 * subscription channels.
 *
 * INVARIANTS (locked):
 *   • Each domain store has its OWN version counter and subscriber set.
 *   • A commit to domain A MUST NOT notify subscribers of domain B.
 *   • Snapshots returned by getSnapshot() are FROZEN — callers cannot
 *     mutate canonical state through a returned reference.
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
   * @param {string} name            - domain name, for diagnostics
   * @param {object} initialSnapshot - initial state (will be frozen)
   */
  constructor(name, initialSnapshot) {
    if (!name) throw new TypeError("DomainStore: name is required");
    this.#name = name;
    this.#snapshot = Object.freeze({ ...initialSnapshot });
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
   * @param {object} snapshot - new state (will be frozen + shallow-copied)
   */
  _applyCommit(snapshot) {
    this.#snapshot = Object.freeze({ ...snapshot });
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
