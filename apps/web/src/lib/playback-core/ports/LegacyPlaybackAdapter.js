/**
 * LegacyPlaybackAdapter — read-only migration seam between the legacy engine
 * and 2MRRW Playback Core.
 *
 * PURPOSE:
 *   Provides legacy-engine code (Zustand stores, React hooks, audio-engine-runtime)
 *   with read access to Core domain snapshots. It never writes to Core state.
 *   It never exposes mutable refs. It returns frozen copies on every read.
 *
 * LOCKED INVARIANTS:
 *   Rule 4: No component may consume both legacy AND Core versions of the same
 *           domain simultaneously. The adapter is the bridge during transition,
 *           not a dual-write path.
 *   Rule 5: No mutable refs cross the legacy/Core migration seam.
 *
 * MIGRATION PATTERN:
 *   During Slice 0: all domains are LEGACY. The adapter methods return null
 *   for any domain not yet owned by Core, signaling that the caller should
 *   fall back to legacy state.
 *
 *   As domains migrate to Core ownership (Slices 1–12), the adapter returns
 *   live Core snapshots. When all domains are Core, this adapter is no longer
 *   needed and is deleted with the legacy engine.
 *
 * NOTE: This class intentionally has no dependency on React, Zustand, or
 *       any legacy component. It is a pure data bridge.
 */

export class LegacyPlaybackAdapter {
  #stores;
  #ownershipRegistry;

  /**
   * @param {object} deps
   * @param {Map<string, import('../state/DomainStore.js').DomainStore>}                 deps.stores
   * @param {import('../ownership/DomainOwnershipRegistry.js').DomainOwnershipRegistry} deps.ownershipRegistry
   */
  constructor({ stores, ownershipRegistry }) {
    this.#stores            = stores;
    this.#ownershipRegistry = ownershipRegistry;
  }

  /**
   * Get a frozen snapshot from a Core-owned store.
   * Returns null if the domain is still LEGACY-owned — caller should use
   * legacy state instead.
   *
   * Returns an immutable copy so callers cannot accidentally mutate Core state.
   * The copy is frozen at the DomainStore level via _applyCommit; this method
   * returns the reference directly (already frozen). No extra copy needed.
   *
   * @param {string} storeKey  - StoreKey constant
   * @param {string} domain    - Domain constant for ownership check
   * @returns {Readonly<object>|null}
   */
  getSnapshot(storeKey, domain) {
    if (!this.#ownershipRegistry.isOwnedByCore(domain)) {
      return null;
    }
    const store = this.#stores.get(storeKey);
    if (!store) return null;
    return store.getSnapshot();
  }

  /**
   * Subscribe to a Core-owned store's changes.
   * Returns null if domain is LEGACY-owned (subscribe to legacy state instead).
   * Returns an unsubscribe function if Core-owned.
   *
   * @param {string}   storeKey
   * @param {string}   domain
   * @param {Function} listener
   * @returns {(() => void)|null}
   */
  subscribe(storeKey, domain, listener) {
    if (!this.#ownershipRegistry.isOwnedByCore(domain)) {
      return null;
    }
    const store = this.#stores.get(storeKey);
    if (!store) return null;
    return store.subscribe(listener);
  }

  /**
   * Reports which domains are currently Core-owned.
   * Used by migration tooling and tests; not consumed by production code.
   *
   * @returns {Record<string, "LEGACY" | "CORE">}
   */
  getOwnershipMap() {
    return this.#ownershipRegistry.getOwnershipMap();
  }
}
