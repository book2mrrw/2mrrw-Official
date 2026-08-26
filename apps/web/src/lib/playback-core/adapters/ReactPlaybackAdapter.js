/**
 * ReactPlaybackAdapter — permanent React integration boundary for 2MRRW Playback Core.
 *
 * This is the ONLY place in the Core that interacts with React's rendering lifecycle.
 * It uses useSyncExternalStore for all domain subscriptions, guaranteeing:
 *   - Concurrent-mode safety (no tearing between reads)
 *   - Selector stability (reference equality prevents redundant renders)
 *   - Subscription cleanup on unmount
 *
 * RULES (locked):
 *   - No other Core file imports from React.
 *   - This adapter wraps DomainStore.subscribe() and DomainStore.getSnapshot().
 *   - The caller (React component or hook) provides a selector function.
 *     The selector is memoized-by-caller; this adapter does not memoize it.
 *   - TransportTimeline updates arrive ~4Hz. All other domains update rarely.
 *
 * HOOK SIGNATURES (stable across all 13 slices):
 *   useNowPlaying(selector?)
 *   useTransportStatus(selector?)
 *   useTransportTimeline(selector?)
 *   useTransportMode(selector?)
 *   useQueue(selector?)
 *   useCapability(selector?)
 *   useContinuity(selector?)
 *   useDiagnostics(selector?)
 *
 * Each hook accepts an optional selector: (snapshot) => derivedValue.
 * When no selector is provided the full snapshot is returned.
 * Selectors that return the same reference are === stable — no re-render.
 *
 * In Slice 0 all domains are LEGACY-owned. Hooks return the initial empty
 * snapshots from DomainStore. This is expected — they'll populate as domains
 * migrate to Core ownership in later slices.
 *
 * IMPORTANT: This file requires React 18+ (useSyncExternalStore).
 * In environments without React (Node.js tests), hooks throw if called.
 * The adapter class itself is importable without React.
 */

import { useSyncExternalStore } from "react";
import { StoreKey } from "../types/index.js";

// ─── React import guard ──────────────────────────────────────────────────────
// Lazy: resolved at hook call time, not at module parse time.
// This lets the adapter class be imported and instantiated in Node tests.
// ─── Identity selector ───────────────────────────────────────────────────────
const identity = (x) => x;

// ─── Adapter class ───────────────────────────────────────────────────────────

export class ReactPlaybackAdapter {
  #stores;

  /**
   * @param {Map<string, import('../state/DomainStore.js').DomainStore>} stores
   */
  constructor(stores) {
    this.#stores = stores;
  }

  /**
   * Returns a bound hook that subscribes to a domain store with selector support.
   * The hook is framework-safe (useSyncExternalStore).
   *
   * @param {string} storeKey - StoreKey constant
   * @returns {(selector?: Function) => any}
   */
  #makeHook(storeKey) {
    const store = this.#stores.get(storeKey);
    if (!store) {
      throw new Error(`[PlaybackCore] ReactPlaybackAdapter: unknown storeKey "${storeKey}"`);
    }

    // These closures are created once per adapter instance, not per hook call.
    const subscribe    = (listener) => store.subscribe(listener);
    const getSnapshot  = ()         => store.getSnapshot();

    return function useDomainStore(selector = identity) {
      // useSyncExternalStore handles subscribe + getSnapshot.
      // The selector wraps getSnapshot to derive the value.
      // React compares selector results with ===; stable references skip re-renders.
      const getSelected = selector === identity
        ? getSnapshot
        : () => selector(getSnapshot());

      return useSyncExternalStore(subscribe, getSelected, getSelected);
    };
  }

  // ─── Public hooks ──────────────────────────────────────────────────────────
  // Each is a stable function reference — safe to call inside React components.

  /** @type {(selector?: (s: object) => any) => any} */
  get useNowPlaying()        { return this.#makeHook(StoreKey.NOW_PLAYING); }

  /** @type {(selector?: (s: object) => any) => any} */
  get useTransportStatus()   { return this.#makeHook(StoreKey.TRANSPORT_STATUS); }

  /**
   * High-frequency: updates ~4Hz during playback.
   * Subscribe only to fields you actually render (position, duration, buffered).
   * @type {(selector?: (s: object) => any) => any}
   */
  get useTransportTimeline() { return this.#makeHook(StoreKey.TRANSPORT_TIMELINE); }

  /** @type {(selector?: (s: object) => any) => any} */
  get useTransportMode()     { return this.#makeHook(StoreKey.TRANSPORT_MODE); }

  /** @type {(selector?: (s: object) => any) => any} */
  get useQueue()             { return this.#makeHook(StoreKey.QUEUE); }

  /** @type {(selector?: (s: object) => any) => any} */
  get useCapability()        { return this.#makeHook(StoreKey.CAPABILITY); }

  /** @type {(selector?: (s: object) => any) => any} */
  get useContinuity()        { return this.#makeHook(StoreKey.CONTINUITY); }

  /** @type {(selector?: (s: object) => any) => any} */
  get useDiagnostics()       { return this.#makeHook(StoreKey.DIAGNOSTICS); }
}
