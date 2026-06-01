/**
 * Phase 15 — playback orchestration state machine.
 * Recovery is centralized here: only the registered recover executor may call recoverAudioHard.
 */

import { useSyncExternalStore } from "react";

export const PLAYBACK_ORCHESTRATION_STATES = Object.freeze({
  IDLE: "IDLE",
  LOADING: "LOADING",
  PLAYING: "PLAYING",
  PAUSED: "PAUSED",
  DEGRADED: "DEGRADED",
  RECOVERING: "RECOVERING",
});

export const PLAYBACK_ORCHESTRATION_EVENTS = Object.freeze({
  LOAD_START: "LOAD_START",
  LOAD_END: "LOAD_END",
  PLAY_SUCCESS: "PLAY_SUCCESS",
  PLAY_PAUSE: "PLAY_PAUSE",
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
    /** @type {Promise<boolean> | null} */
    this.recoveryPromise = null;
  }

  /**
   * @param {(reason: string, opts?: { resumeAfter?: boolean }) => Promise<boolean> | null} fn
   */
  setRecoverExecutor(fn) {
    this.recoverExecutor = typeof fn === "function" ? fn : null;
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
    switch (event) {
      case PLAYBACK_ORCHESTRATION_EVENTS.LOAD_START:
        if (this.state !== PLAYBACK_ORCHESTRATION_STATES.RECOVERING) {
          this._setState(PLAYBACK_ORCHESTRATION_STATES.LOADING);
        }
        return true;

      case PLAYBACK_ORCHESTRATION_EVENTS.LOAD_END:
        if (this.state === PLAYBACK_ORCHESTRATION_STATES.RECOVERING) return true;
        this._setState(
          payload.playing
            ? PLAYBACK_ORCHESTRATION_STATES.PLAYING
            : PLAYBACK_ORCHESTRATION_STATES.PAUSED
        );
        return true;

      case PLAYBACK_ORCHESTRATION_EVENTS.PLAY_SUCCESS:
        if (this.state !== PLAYBACK_ORCHESTRATION_STATES.RECOVERING) {
          this._setState(PLAYBACK_ORCHESTRATION_STATES.PLAYING);
        }
        return true;

      case PLAYBACK_ORCHESTRATION_EVENTS.PLAY_PAUSE:
        if (this.state !== PLAYBACK_ORCHESTRATION_STATES.RECOVERING) {
          this._setState(PLAYBACK_ORCHESTRATION_STATES.PAUSED);
        }
        return true;

      case PLAYBACK_ORCHESTRATION_EVENTS.STOP:
      case PLAYBACK_ORCHESTRATION_EVENTS.RESET:
        this._setState(PLAYBACK_ORCHESTRATION_STATES.IDLE);
        return true;

      case PLAYBACK_ORCHESTRATION_EVENTS.RECOVER_COMPLETE:
        this._setState(
          payload.playing
            ? PLAYBACK_ORCHESTRATION_STATES.PLAYING
            : PLAYBACK_ORCHESTRATION_STATES.PAUSED
        );
        return true;

      case PLAYBACK_ORCHESTRATION_EVENTS.RECOVER_FAILED:
        this._setState(PLAYBACK_ORCHESTRATION_STATES.DEGRADED);
        return false;

      case PLAYBACK_ORCHESTRATION_EVENTS.AUDIO_DESYNC_DETECTED:
      case PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED:
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
