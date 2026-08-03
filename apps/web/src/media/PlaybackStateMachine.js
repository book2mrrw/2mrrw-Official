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

class PlaybackStateMachine {
  constructor() {
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
  }

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
}

/** Singleton orchestrator for the app audio engine. */
export const playbackStateMachine = new PlaybackStateMachine();

/** React hook — orchestration state only (display/diagnostics). */
export function usePlaybackStateMachine() {
  return useSyncExternalStore(
    (onStoreChange) => playbackStateMachine.subscribe(() => onStoreChange()),
    () => playbackStateMachine.getState(),
    () => playbackStateMachine.getState()
  );
}
