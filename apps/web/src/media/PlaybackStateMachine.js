/**
 * Phase 15 — playback orchestration state machine.
 * Recovery is centralized here: only the registered recover executor may call recoverAudioHard.
 *
 * State diagram:
 *
 *   IDLE
 *     └─ LOAD_START → LOADING
 *
 *   LOADING
 *     ├─ LOAD_END(playing)  → PLAYING
 *     ├─ LOAD_END(!playing) → PAUSED
 *     └─ recovery events    → RECOVERING
 *
 *   PLAYING
 *     ├─ PLAY_PAUSE         → PAUSED
 *     ├─ BUFFER_START       → BUFFERING
 *     ├─ CROSSFADE_START    → CROSSFADE
 *     └─ recovery events    → RECOVERING
 *
 *   BUFFERING
 *     ├─ BUFFER_END         → PLAYING
 *     ├─ PLAY_PAUSE         → PAUSED
 *     └─ recovery events    → RECOVERING
 *
 *   CROSSFADE
 *     ├─ CROSSFADE_END      → PLAYING
 *     ├─ PLAY_PAUSE         → PAUSED
 *     └─ recovery events    → RECOVERING
 *
 *   PAUSED
 *     ├─ PLAY_SUCCESS       → PLAYING
 *     ├─ LOAD_START         → LOADING
 *     └─ recovery events    → RECOVERING
 *
 *   RECOVERING
 *     ├─ RECOVER_COMPLETE(playing)  → PLAYING
 *     ├─ RECOVER_COMPLETE(!playing) → PAUSED
 *     └─ RECOVER_FAILED            → DEGRADED
 *
 *   DEGRADED
 *     └─ RECOVERY_REQUESTED (explicit only) → RECOVERING
 */

import { useSyncExternalStore } from "react";

export const PLAYBACK_ORCHESTRATION_STATES = Object.freeze({
  IDLE: "IDLE",
  LOADING: "LOADING",
  PLAYING: "PLAYING",
  BUFFERING: "BUFFERING",
  CROSSFADE: "CROSSFADE",
  PAUSED: "PAUSED",
  DEGRADED: "DEGRADED",
  RECOVERING: "RECOVERING",
});

export const PLAYBACK_ORCHESTRATION_EVENTS = Object.freeze({
  LOAD_START: "LOAD_START",
  LOAD_END: "LOAD_END",
  PLAY_SUCCESS: "PLAY_SUCCESS",
  PLAY_PAUSE: "PLAY_PAUSE",
  BUFFER_START: "BUFFER_START",
  BUFFER_END: "BUFFER_END",
  CROSSFADE_START: "CROSSFADE_START",
  CROSSFADE_END: "CROSSFADE_END",
  STOP: "STOP",
  RESET: "RESET",
  AUDIO_DESYNC_DETECTED: "AUDIO_DESYNC_DETECTED",
  RECOVERY_REQUESTED: "RECOVERY_REQUESTED",
  RECOVER_COMPLETE: "RECOVER_COMPLETE",
  RECOVER_FAILED: "RECOVER_FAILED",
});

const RECOVERY_EVENTS = new Set([
  PLAYBACK_ORCHESTRATION_EVENTS.AUDIO_DESYNC_DETECTED,
  PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED,
]);

// ── Context channel routing ────────────────────────────────────────────────
// These key sets determine which observable channels fire on a given context patch.
// Mirrors the TRANSPORT_ONLY_STATE_KEYS optimization in AudioContext.js so existing
// callers (patchState, transport store, progress store) stay coherent during migration.

const _PROGRESS_KEYS  = new Set(["currentTime", "duration"]);
const _TRANSPORT_KEYS = new Set(["playbackNetworkState", "isBuffering"]);
const _IDENTITY_KEYS  = new Set(["currentTrackId", "currentTrack", "isPlaying"]);
const _UI_KEYS        = new Set(["sleepTimerEndsAt", "sleepAfterCurrentTrack", "crossfadeEnabled", "previewEnded", "continuityFrozen"]);

/**
 * Initial playback context — mirrors AudioContext.js EMPTY_STATE.
 * Exported so AudioContext.js and mobile adapters share one authoritative definition.
 *
 * @typedef {{
 *   currentTrackId: string|null, currentTrack: object|null, source: string|null,
 *   isPlaying: boolean, hasStarted: boolean, playbackState: string|null,
 *   error: string|null, accessDenied: boolean, streamRetryable: boolean, streamConflict: string|null,
 *   queue: object[], queueIndex: number,
 *   repeatMode: "off"|"one"|"all", shuffle: boolean,
 *   csMode: boolean, csTrack: object|null,
 *   spaceMode: boolean, bassMode: boolean, atmosphereLevel: number,
 *   isBuffering: boolean, playbackNetworkState: string, osInterrupted: boolean,
 *   currentTime: number, duration: number
 * }} PlaybackContext
 */
export const INITIAL_PLAYBACK_CONTEXT = Object.freeze({
  // Track identity
  currentTrackId: null,
  currentTrack: null,
  source: null,

  // Transport
  isPlaying: false,
  hasStarted: false,
  playbackState: null,

  // Error / access
  error: null,
  accessDenied: false,
  streamRetryable: false,
  streamConflict: null,

  // Queue
  queue: [],
  queueIndex: -1,

  // Modes
  repeatMode: "off",
  shuffle: false,
  csMode: false,
  csTrack: null,

  // Audio effects
  spaceMode: false,
  bassMode: false,
  atmosphereLevel: 3,

  // High-frequency — transport channel
  isBuffering: false,
  playbackNetworkState: "idle",

  // High-frequency — progress channel
  currentTime: 0,
  duration: 0,

  // UI preferences / session state — UI channel
  sleepTimerEndsAt: null,
  sleepAfterCurrentTrack: false,
  crossfadeEnabled: false,       // runtime value overridden in constructor from localStorage
  previewEnded: false,
  continuityFrozen: false,
  // OS interrupt flag — true while audio is paused by a phone call / Siri / system event
  // and the user has NOT explicitly paused. Cleared on the next onPlay. Used by the
  // player button to show buffering state rather than ▶ Play during the call.
  osInterrupted: false,
});

class PlaybackStateMachine {
  constructor() {
    // ── Orchestration state (original Phase 15) ───────────────────────────────

    /** @type {keyof typeof PLAYBACK_ORCHESTRATION_STATES} */
    this.state = PLAYBACK_ORCHESTRATION_STATES.IDLE;
    /** @type {Set<(state: string) => void>} */
    this.listeners = new Set();
    /** @type {((reason: string, opts?: { resumeAfter?: boolean }) => Promise<boolean>) | null} */
    this.recoverExecutor = null;
    /** @type {(() => boolean) | null} Phase 21B — block recovery when OS_SUSPENDED. */
    this.lifecycleRecoveryGuard = null;
    /** @type {Promise<boolean> | null} */
    this.recoveryPromise = null;

    // ── Business context (world-class B+C architecture) ───────────────────────
    // The full playback state that AudioContext.js currently owns as React useState.
    // All business state changes flow through updateContext() — never mutate directly.

    // Read crossfadeEnabled from localStorage at singleton init (browser-only singleton).
    const _cfStored = typeof window !== "undefined" && window.localStorage.getItem("2mrrw_crossfade") === "1";

    /** @type {PlaybackContext} The authoritative playback business state. */
    this.context = Object.assign({}, INITIAL_PLAYBACK_CONTEXT, { crossfadeEnabled: _cfStored });

    // Frozen snapshots — useSyncExternalStore requires a stable reference that only
    // changes (as a new object) when the data actually changes.
    /** @type {Readonly<PlaybackContext>} */
    this._contextSnapshot  = Object.freeze(Object.assign({}, INITIAL_PLAYBACK_CONTEXT, { crossfadeEnabled: _cfStored }));
    /** @type {Readonly<{isBuffering:boolean, playbackNetworkState:string}>} */
    this._transportSnapshot = Object.freeze({ isBuffering: false, playbackNetworkState: "idle" });
    /** @type {Readonly<{currentTime:number, duration:number}>} */
    this._progressSnapshot  = Object.freeze({ currentTime: 0, duration: 0 });
    /** @type {Readonly<{currentTrackId:string|null, currentTrackSlug:string|null, isPlaying:boolean}>} */
    this._identitySnapshot  = Object.freeze({ currentTrackId: null, currentTrackSlug: null, isPlaying: false });
    /** @type {Readonly<{sleepTimerEndsAt:number|null, sleepAfterCurrentTrack:boolean, crossfadeEnabled:boolean, previewEnded:boolean, continuityFrozen:boolean}>} */
    this._uiSnapshot        = Object.freeze({ sleepTimerEndsAt: null, sleepAfterCurrentTrack: false, crossfadeEnabled: _cfStored, previewEnded: false, continuityFrozen: false });

    /** @type {Set<Function>} Main business context listeners (React full re-render). */
    this._contextListeners  = new Set();
    /** @type {Set<Function>} Transport-only listeners (isBuffering, networkState). */
    this._transportListeners = new Set();
    /** @type {Set<Function>} Progress listeners (currentTime, duration per-tick). */
    this._progressListeners  = new Set();
    /** @type {Set<Function>} Identity listeners (track identity for storefront cards). */
    this._identityListeners  = new Set();
    /** @type {Set<Function>} UI preference / session state listeners. */
    this._uiListeners        = new Set();
  }

  // ── Orchestration API (original Phase 15 — unchanged) ─────────────────────

  /**
   * @param {(reason: string, opts?: { resumeAfter?: boolean }) => Promise<boolean> | null} fn
   */
  setRecoverExecutor(fn) {
    this.recoverExecutor = typeof fn === "function" ? fn : null;
  }

  /**
   * @param {(() => boolean) | null} fn — return true to block recovery transitions
   */
  setLifecycleRecoveryGuard(fn) {
    this.lifecycleRecoveryGuard = typeof fn === "function" ? fn : null;
  }

  getState() {
    return this.state;
  }

  /**
   * @param {(state: string) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit() {
    const snapshot = this.state;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        /* listener fault isolation */
      }
    }
  }

  /**
   * @param {string} next
   */
  _setState(next) {
    if (this.state === next) return;
    this.state = next;
    this._emit();
  }

  /**
   * @param {string} event
   * @param {{ reason?: string, resumeAfter?: boolean, playing?: boolean }} [payload]
   * @returns {Promise<boolean> | boolean}
   */
  transition(event, payload = {}) {
    const S = PLAYBACK_ORCHESTRATION_STATES;
    const E = PLAYBACK_ORCHESTRATION_EVENTS;

    switch (event) {
      // ── Track load ──────────────────────────────────────────────────────────
      case E.LOAD_START:
        if (this.state !== S.RECOVERING) {
          this._setState(S.LOADING);
        }
        return true;

      case E.LOAD_END:
        if (this.state === S.RECOVERING) return true;
        this._setState(payload.playing ? S.PLAYING : S.PAUSED);
        return true;

      // ── Normal play / pause ─────────────────────────────────────────────────
      case E.PLAY_SUCCESS:
        if (this.state !== S.RECOVERING) {
          this._setState(S.PLAYING);
        }
        return true;

      case E.PLAY_PAUSE:
        if (this.state !== S.RECOVERING) {
          this._setState(S.PAUSED);
        }
        return true;

      // ── Buffering (mid-playback stall) ──────────────────────────────────────
      case E.BUFFER_START:
        // Only enter BUFFERING from active playback states; ignore if loading/recovering.
        if (this.state === S.PLAYING || this.state === S.CROSSFADE) {
          this._setState(S.BUFFERING);
        }
        return true;

      case E.BUFFER_END:
        if (this.state === S.BUFFERING) {
          this._setState(S.PLAYING);
        }
        return true;

      // ── Crossfade ───────────────────────────────────────────────────────────
      case E.CROSSFADE_START:
        if (this.state === S.PLAYING) {
          this._setState(S.CROSSFADE);
        }
        return true;

      case E.CROSSFADE_END:
        if (this.state === S.CROSSFADE) {
          this._setState(S.PLAYING);
        }
        return true;

      // ── Stop / reset ────────────────────────────────────────────────────────
      case E.STOP:
      case E.RESET:
        this._setState(S.IDLE);
        return true;

      // ── Recovery completion ─────────────────────────────────────────────────
      case E.RECOVER_COMPLETE:
        this._setState(payload.playing ? S.PLAYING : S.PAUSED);
        return true;

      case E.RECOVER_FAILED:
        this._setState(S.DEGRADED);
        return false;

      // ── Recovery entry ──────────────────────────────────────────────────────
      case E.AUDIO_DESYNC_DETECTED:
      case E.RECOVERY_REQUESTED:
        return this._beginRecovery(event, payload);

      default:
        return false;
    }
  }

  /**
   * @param {string} event
   * @param {{ reason?: string, resumeAfter?: boolean }} payload
   */
  _beginRecovery(event, payload) {
    if (!RECOVERY_EVENTS.has(event)) return Promise.resolve(false);
    if (this.recoveryPromise) return this.recoveryPromise;
    // When DEGRADED, auto-desync events are absorbed — the audibility watchdog would
    // busy-loop at 1250ms if we allowed them through. Only explicit RECOVERY_REQUESTED
    // (from user action or command dispatch) may re-enter recovery from DEGRADED.
    if (
      this.state === PLAYBACK_ORCHESTRATION_STATES.DEGRADED &&
      event !== PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED
    ) {
      return Promise.resolve(false);
    }
    if (this.lifecycleRecoveryGuard?.()) {
      return Promise.resolve(false);
    }

    const reason =
      payload.reason ||
      (event === PLAYBACK_ORCHESTRATION_EVENTS.AUDIO_DESYNC_DETECTED
        ? "audio_desync"
        : "recovery_requested");
    const resumeAfter = Boolean(payload.resumeAfter);

    this._setState(PLAYBACK_ORCHESTRATION_STATES.RECOVERING);

    const executor = this.recoverExecutor;
    if (!executor) {
      this.transition(PLAYBACK_ORCHESTRATION_EVENTS.RECOVER_FAILED, { reason });
      return Promise.resolve(false);
    }

    this.recoveryPromise = (async () => {
      try {
        const ok = await executor(reason, { resumeAfter });
        if (ok) {
          this.transition(PLAYBACK_ORCHESTRATION_EVENTS.RECOVER_COMPLETE, {
            playing: resumeAfter,
          });
        } else {
          this.transition(PLAYBACK_ORCHESTRATION_EVENTS.RECOVER_FAILED, {
            reason: resumeAfter ? `${reason}:audibility_or_resume` : reason,
          });
        }
        return ok;
      } catch {
        this.transition(PLAYBACK_ORCHESTRATION_EVENTS.RECOVER_FAILED, { reason });
        return false;
      } finally {
        this.recoveryPromise = null;
      }
    })();

    return this.recoveryPromise;
  }

  // ── Business context API (world-class B+C architecture) ───────────────────

  /**
   * Update playback context — the world-class replacement for AudioContext.js patchState.
   *
   * Routes notifications to only the listeners that care about the changed fields:
   *   progress keys   → progressListeners only (currentTime, duration — per animation frame)
   *   transport keys  → transportListeners only (isBuffering, playbackNetworkState)
   *   identity keys   → identityListeners + contextListeners (track change, play/pause)
   *   everything else → contextListeners only
   *
   * This preserves the existing TRANSPORT_ONLY_STATE_KEYS optimization in AudioContext.js
   * while extending it to the full state authority pattern.
   *
   * @param {Partial<PlaybackContext>} patch
   */
  updateContext(patch) {
    if (!patch) return;
    const keys = Object.keys(patch);
    if (!keys.length) return;

    const prev = this.context;
    const next = Object.assign({}, prev, patch);
    this.context = next;

    let notifyMain      = false;
    let notifyTransport = false;
    let notifyProgress  = false;
    let notifyIdentity  = false;
    let notifyUI        = false;

    for (const key of keys) {
      if (_PROGRESS_KEYS.has(key)) {
        notifyProgress = true;
      } else if (_TRANSPORT_KEYS.has(key)) {
        notifyTransport = true;
      } else if (_IDENTITY_KEYS.has(key)) {
        notifyIdentity = true;
        notifyMain = true;
      } else if (_UI_KEYS.has(key)) {
        notifyUI = true;
      } else {
        notifyMain = true;
      }
    }

    // Transport snapshot must be updated BEFORE _emitContext() fires. The AudioContext
    // useMemo calls getTransportSnapshot() during its recompute — if a mixed patch
    // (e.g. isPlaying:true + isBuffering:false from onPlay) emits the context channel
    // first, the useMemo reads a stale _transportSnapshot that still holds isBuffering:true
    // from the 500ms buffer-show timer, permanently locking the spinner visible.
    let _transportChanged = false;
    if (notifyTransport) {
      const prevT = this._transportSnapshot;
      if (prevT.isBuffering !== next.isBuffering || prevT.playbackNetworkState !== next.playbackNetworkState) {
        this._transportSnapshot = Object.freeze({
          isBuffering: Boolean(next.isBuffering),
          playbackNetworkState: next.playbackNetworkState ?? "idle",
        });
        _transportChanged = true;
      }
    }

    if (notifyMain) {
      this._contextSnapshot = Object.freeze(next);
      this._emitContext();
    }
    if (_transportChanged) {
      this._emitTransport();
    }
    if (notifyProgress) {
      const prevP = this._progressSnapshot;
      if (prevP.currentTime !== next.currentTime || prevP.duration !== next.duration) {
        this._progressSnapshot = Object.freeze({
          currentTime: next.currentTime ?? 0,
          duration: next.duration ?? 0,
        });
        this._emitProgress();
      }
    }
    if (notifyIdentity) {
      const prevId = this._identitySnapshot;
      const nextTrackId  = next.currentTrackId ?? null;
      const nextSlug     = next.currentTrack?.slug ?? null;
      const nextPlaying  = Boolean(next.isPlaying);
      if (prevId.currentTrackId !== nextTrackId || prevId.currentTrackSlug !== nextSlug || prevId.isPlaying !== nextPlaying) {
        this._identitySnapshot = Object.freeze({
          currentTrackId: nextTrackId,
          currentTrackSlug: nextSlug,
          isPlaying: nextPlaying,
        });
        this._emitIdentity();
      }
    }
    if (notifyUI) {
      this._uiSnapshot = Object.freeze({
        sleepTimerEndsAt:      next.sleepTimerEndsAt      ?? null,
        sleepAfterCurrentTrack: Boolean(next.sleepAfterCurrentTrack),
        crossfadeEnabled:      Boolean(next.crossfadeEnabled),
        previewEnded:          Boolean(next.previewEnded),
        continuityFrozen:      Boolean(next.continuityFrozen),
      });
      this._emitUI();
    }
  }

  /** @returns {PlaybackContext} Live mutable context — read-only, never mutate directly. */
  getContext() {
    return this.context;
  }

  /** @returns {Readonly<PlaybackContext>} Frozen snapshot for useSyncExternalStore. */
  getContextSnapshot() {
    return this._contextSnapshot;
  }

  /**
   * Subscribe to main business context changes (full re-render channel).
   * @param {(snapshot: Readonly<PlaybackContext>) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribeContext(listener) {
    this._contextListeners.add(listener);
    return () => this._contextListeners.delete(listener);
  }

  /** @returns {Readonly<{isBuffering:boolean, playbackNetworkState:string}>} */
  getTransportSnapshot() {
    return this._transportSnapshot;
  }

  /**
   * Subscribe to high-frequency transport state changes (isBuffering, playbackNetworkState).
   * @param {Function} listener
   * @returns {() => void} unsubscribe
   */
  subscribeTransport(listener) {
    this._transportListeners.add(listener);
    return () => this._transportListeners.delete(listener);
  }

  /** @returns {Readonly<{currentTime:number, duration:number}>} */
  getProgressSnapshot() {
    return this._progressSnapshot;
  }

  /**
   * Subscribe to per-tick progress updates (currentTime, duration).
   * @param {Function} listener
   * @returns {() => void} unsubscribe
   */
  subscribeProgress(listener) {
    this._progressListeners.add(listener);
    return () => this._progressListeners.delete(listener);
  }

  /** @returns {Readonly<{currentTrackId:string|null, currentTrackSlug:string|null, isPlaying:boolean}>} */
  getIdentitySnapshot() {
    return this._identitySnapshot;
  }

  /**
   * Subscribe to track identity changes (storefront card highlights).
   * @param {Function} listener
   * @returns {() => void} unsubscribe
   */
  subscribeIdentity(listener) {
    this._identityListeners.add(listener);
    return () => this._identityListeners.delete(listener);
  }

  /** @returns {Readonly<{sleepTimerEndsAt:number|null, sleepAfterCurrentTrack:boolean, crossfadeEnabled:boolean, previewEnded:boolean, continuityFrozen:boolean}>} */
  getUISnapshot() {
    return this._uiSnapshot;
  }

  /**
   * Subscribe to UI preference / session state changes.
   * Covers sleepTimerEndsAt, sleepAfterCurrentTrack, crossfadeEnabled, previewEnded, continuityFrozen.
   * Fires independently from the context channel — UI changes do not re-render context consumers.
   * @param {Function} listener
   * @returns {() => void} unsubscribe
   */
  subscribeUI(listener) {
    this._uiListeners.add(listener);
    return () => this._uiListeners.delete(listener);
  }

  /**
   * Reset all context to initial state and orchestration state to IDLE.
   * Called on hard reset / provider unmount.
   */
  resetContext() {
    // Preserve crossfadeEnabled across stop/reset — it is a durable user preference.
    const savedCf = this._uiSnapshot.crossfadeEnabled;
    const fresh = Object.assign({}, INITIAL_PLAYBACK_CONTEXT, { crossfadeEnabled: savedCf });
    this.context = fresh;
    this._contextSnapshot  = Object.freeze(fresh);
    this._transportSnapshot = Object.freeze({ isBuffering: false, playbackNetworkState: "idle" });
    this._progressSnapshot  = Object.freeze({ currentTime: 0, duration: 0 });
    this._identitySnapshot  = Object.freeze({ currentTrackId: null, currentTrackSlug: null, isPlaying: false });
    this._uiSnapshot        = Object.freeze({ sleepTimerEndsAt: null, sleepAfterCurrentTrack: false, crossfadeEnabled: savedCf, previewEnded: false, continuityFrozen: false });
    this._emitContext();
    this._emitTransport();
    this._emitProgress();
    this._emitIdentity();
    this._emitUI();
    this._setState(PLAYBACK_ORCHESTRATION_STATES.IDLE);
  }

  /**
   * Force-emit the current progress snapshot unconditionally, bypassing the value-equality check.
   * Used by AudioContext.js Phase 21C continuity freeze to push a frozen position to consumers
   * even when currentTime/duration values haven't numerically changed since the last emission.
   */
  forceEmitProgress() {
    this._emitProgress();
  }

  _emitContext() {
    const s = this._contextSnapshot;
    for (const fn of this._contextListeners) { try { fn(s); } catch {} }
  }

  _emitTransport() {
    const s = this._transportSnapshot;
    for (const fn of this._transportListeners) { try { fn(s); } catch {} }
  }

  _emitProgress() {
    const s = this._progressSnapshot;
    for (const fn of this._progressListeners) { try { fn(s); } catch {} }
  }

  _emitIdentity() {
    const s = this._identitySnapshot;
    for (const fn of this._identityListeners) { try { fn(s); } catch {} }
  }

  _emitUI() {
    const s = this._uiSnapshot;
    for (const fn of this._uiListeners) { try { fn(s); } catch {} }
  }
}

/** Singleton orchestrator — one instance per tab, survives React tree tears. */
export const playbackStateMachine = new PlaybackStateMachine();

// ── React hooks ────────────────────────────────────────────────────────────

/** React hook — orchestration state only (PLAYING / PAUSED / LOADING / …). */
export function usePlaybackStateMachine() {
  return useSyncExternalStore(
    (onStoreChange) => playbackStateMachine.subscribe(() => onStoreChange()),
    () => playbackStateMachine.getState(),
    () => playbackStateMachine.getState()
  );
}

/**
 * React hook — full playback business context.
 * Triggers re-render on any non-transport, non-progress field change.
 * Replaces reading AudioContext.js state directly for non-performance-critical fields.
 */
export function usePlaybackContext() {
  return useSyncExternalStore(
    (onChange) => playbackStateMachine.subscribeContext(() => onChange()),
    () => playbackStateMachine.getContextSnapshot(),
    () => playbackStateMachine.getContextSnapshot()
  );
}

/**
 * React hook — high-frequency transport state (isBuffering, playbackNetworkState).
 * Does NOT re-render on track changes or queue changes.
 */
export function usePlaybackTransport() {
  return useSyncExternalStore(
    (onChange) => playbackStateMachine.subscribeTransport(() => onChange()),
    () => playbackStateMachine.getTransportSnapshot(),
    () => playbackStateMachine.getTransportSnapshot()
  );
}

/**
 * React hook — per-tick position and duration.
 * Fired on every timeupdate; keep consumer render cost to a minimum.
 */
export function usePlaybackProgress() {
  return useSyncExternalStore(
    (onChange) => playbackStateMachine.subscribeProgress(() => onChange()),
    () => playbackStateMachine.getProgressSnapshot(),
    () => playbackStateMachine.getProgressSnapshot()
  );
}

/**
 * React hook — track identity for storefront card play-state highlights.
 * Only re-renders when currentTrackId, currentTrack, or isPlaying changes.
 */
export function usePlaybackIdentity() {
  return useSyncExternalStore(
    (onChange) => playbackStateMachine.subscribeIdentity(() => onChange()),
    () => playbackStateMachine.getIdentitySnapshot(),
    () => playbackStateMachine.getIdentitySnapshot()
  );
}

/**
 * React hook — UI preferences and session state.
 * Only re-renders when sleepTimerEndsAt, sleepAfterCurrentTrack, crossfadeEnabled,
 * previewEnded, or continuityFrozen changes. Does NOT re-render on track changes,
 * queue changes, or transport updates.
 */
export function usePlaybackUI() {
  return useSyncExternalStore(
    (onChange) => playbackStateMachine.subscribeUI(() => onChange()),
    () => playbackStateMachine.getUISnapshot(),
    () => playbackStateMachine.getUISnapshot()
  );
}
