"use client";

/**
 * Recovery Coordinator — the single authority for all playback stall recovery.
 *
 * Architecture contract (matches the target architecture diagram):
 *   - Every stall signal (onWaiting, onStalled, watchdog, visibility, online)
 *     calls coordinator.report(). Nothing else.
 *   - The coordinator holds a lock: only one recovery executes at a time.
 *   - Buffer health is verified before any action. If buffered.end − currentTime > 5s,
 *     the browser has data — it is a decode delay, not a network stall. No action taken.
 *   - HLS tracks: hls.startLoad() only. Never seek or reload the audio element.
 *   - Progressive tracks: seek to last buffered start (never forward into the gap).
 *     After MAX_SOFT_ATTEMPTS, escalate to full stream reload.
 *   - Mandatory cooldown after every recovery. No concurrent recoveries. Ever.
 */

import { getHLSEngine } from "@/lib/audio/HLSEngine";
import { isEntitledFullPlaybackTrack } from "@/lib/playback/playback-track-utils";
import { logPlaybackResilience } from "@/lib/diagnostics/state-churn-log";

// ── Tuning constants ────────────────────────────────────────────────────────
const BUFFER_OK_THRESHOLD_S    = 5;     // > 5s buffered ahead = not a real stall
const GRACE_PERIOD_MS          = 2000;  // wait before first action (browser may self-recover)
const COOLDOWN_SOFT_MS         = 8000;  // cooldown after a seek recovery
const COOLDOWN_HARD_MS         = 12000; // cooldown after a full stream reload
const MAX_SOFT_ATTEMPTS        = 3;     // soft seeks before escalating to hard reload
const MAX_HARD_RELOADS         = 3;     // hard reloads before showing error

// ── Utility ─────────────────────────────────────────────────────────────────
function getBufferedAheadSeconds(audio) {
  if (!audio) return 0;
  try {
    const buf = audio.buffered;
    const t   = audio.currentTime;
    for (let i = 0; i < buf.length; i++) {
      if (buf.start(i) <= t + 0.5 && buf.end(i) > t) {
        return buf.end(i) - t;
      }
    }
  } catch {}
  return 0;
}

// ── Recovery Coordinator ────────────────────────────────────────────────────
class RecoveryCoordinator {
  constructor() {
    this._locked          = false;   // true while a recovery action is executing
    this._cooldownUntil   = 0;       // timestamp: no new recovery before this
    this._stallSince      = null;    // timestamp of first stall signal in current cycle
    this._graceTimer      = null;    // setTimeout handle for the grace period
    this._softAttempts    = 0;       // progressive seek attempts in current stall run
    this._hardReloads     = 0;       // full stream reloads since last track change
    this._lastCtx         = null;    // saved context from report() for grace-period callback
  }

  // ── Public: report a potential stall ─────────────────────────────────────

  /**
   * Called by onWaiting, onStalled, audibility watchdog, visibility return,
   * and network-restore handlers. The coordinator decides everything from here.
   *
   * @param {{ audioRef, stateRef, retryStreamPlaybackRef, patchState }} ctx
   */
  report(ctx) {
    const audio = ctx?.audioRef?.current;
    const state = ctx?.stateRef?.current;

    // Only act when we're supposed to be playing
    if (!state?.isPlaying || !state?.currentTrack) return;
    if (!audio || audio.paused) return;

    // Cooldown: a recovery recently completed — let the buffer refill
    if (Date.now() < this._cooldownUntil) return;

    // Lock: a recovery is already in flight
    if (this._locked) return;

    // Buffer health check: does the browser actually lack data?
    const ahead = getBufferedAheadSeconds(audio);
    if (ahead > BUFFER_OK_THRESHOLD_S) {
      // Data exists — this is a decode delay, not a network stall. Clear grace and wait.
      this._clearGrace();
      return;
    }

    // First stall signal in this cycle — start grace period
    if (!this._stallSince) {
      this._stallSince = Date.now();
      this._lastCtx    = ctx;
      console.warn('[2MRRW-TRACE] RC.report → grace started', {
        slug: state.currentTrack?.slug, ahead, t: audio.currentTime.toFixed(2),
      });
      this._graceTimer = setTimeout(() => {
        this._graceTimer = null;
        this._actIfStillStalled();
      }, GRACE_PERIOD_MS);
      return;
    }

    // Grace period is running — update ctx so the timer fires with fresh refs
    this._lastCtx = ctx;
  }

  // ── Public: audio resumed normally ───────────────────────────────────────

  /**
   * Called by onPlaying / onCanPlayThrough. Cancels any pending grace timer
   * and releases the lock. Cooldown stays active — buffer still needs time.
   */
  onPlaybackResumed() {
    console.warn('[2MRRW-TRACE] RC.onPlaybackResumed', { wasActive: this.isActive() });
    this._clearGrace();
    this._locked     = false;
    this._stallSince = null;
    this._softAttempts = 0;
  }

  // ── Public: new track started ─────────────────────────────────────────────

  /**
   * Called by playTrackInternal before loading a new track.
   * Full reset — new track, clean slate.
   */
  resetForNewTrack() {
    this._clearGrace();
    this._locked        = false;
    this._cooldownUntil = 0;
    this._stallSince    = null;
    this._softAttempts  = 0;
    this._hardReloads   = 0;
    this._lastCtx       = null;
  }

  // ── Public: query state ───────────────────────────────────────────────────

  /**
   * Returns true if a recovery is in-flight or cooling down.
   * Used by the audibility watchdog and FATAL_AUDIO_DESYNC guard to defer.
   */
  isActive() {
    return this._locked || Date.now() < this._cooldownUntil || Boolean(this._graceTimer);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _clearGrace() {
    if (this._graceTimer) {
      clearTimeout(this._graceTimer);
      this._graceTimer = null;
    }
  }

  _actIfStillStalled() {
    const ctx   = this._lastCtx;
    const audio = ctx?.audioRef?.current;
    const state = ctx?.stateRef?.current;

    const ahead = audio ? getBufferedAheadSeconds(audio) : -1;
    console.warn('[2MRRW-TRACE] RC._actIfStillStalled', {
      slug: state?.currentTrack?.slug,
      isPlaying: state?.isPlaying,
      audio_paused: audio?.paused,
      ahead: ahead.toFixed(2),
      t: audio?.currentTime?.toFixed(2),
      locked: this._locked,
      cooldownMs: Math.max(0, this._cooldownUntil - Date.now()),
    });

    // Validate conditions are still true after grace period
    if (!state?.isPlaying || !state?.currentTrack) { this._stallSince = null; return; }
    if (!audio || audio.paused)                     { this._stallSince = null; return; }
    if (Date.now() < this._cooldownUntil)           { this._stallSince = null; return; }
    if (this._locked)                               { this._stallSince = null; return; }

    // Re-check buffer — may have filled during grace period
    if (ahead > BUFFER_OK_THRESHOLD_S) {
      this._stallSince = null;
      return;
    }

    // Confirmed real stall — acquire lock and act
    this._locked     = true;
    this._stallSince = null;

    this._execute(audio, state, ctx);
  }

  _execute(audio, state, ctx) {
    const hlsEngine = getHLSEngine();

    // ── HLS path ──────────────────────────────────────────────────────────
    // hls.js IS the buffer intelligence for HLS tracks — it owns the MSE
    // SourceBuffer, manages ABR, retries failed fragments (fragLoadingMaxRetry:3),
    // and calls startLoad() internally on its first fatal network error.
    //
    // onWaiting fires during normal hls.js buffering: the audio element has
    // consumed its decoded data while hls.js downloads the next segment. hls.js
    // is already loading — calling startLoad(-1) here restarts its entire
    // segment download queue, briefly invalidates the SourceBuffer, and forces
    // the audio element to pause. That is the 3-second stop symptom.
    //
    // The coordinator's role for HLS is to not interfere. Fatal HLS errors are
    // surfaced via HLSEngine.onError / onSegmentFatalError, which trigger the
    // retryStreamPlayback escalation path independently of onWaiting.
    if (hlsEngine.isLoaded) {
      logPlaybackResilience("stall-recovery", {
        source: "RecoveryCoordinator",
        code: "HLS_DEFERRED",
        slug: state.currentTrack?.slug ?? null,
        currentTime: audio.currentTime,
      });
      // The cooldown is essential: it keeps FATAL_AUDIO_DESYNC guard and the
      // audibility watchdog suppressed (via isActive()) while hls.js delivers
      // the next segment. Without it, those systems see a briefly-inaudible
      // audio element and set isPlaying:false — the "button returns to play" symptom.
      // The action (startLoad) was wrong. The cooldown was always right.
      this._release(COOLDOWN_SOFT_MS);
      return;
    }

    // ── Progressive path ─────────────────────────────────────────────────
    this._softAttempts++;

    if (this._softAttempts <= MAX_SOFT_ATTEMPTS) {
      // Seek to the START of the last buffered range — delivers us to where data
      // exists without seeking PAST the gap (which fires another onWaiting).
      logPlaybackResilience("stall-recovery", {
        source: "RecoveryCoordinator",
        code: "PROGRESSIVE_SEEK",
        slug: state.currentTrack?.slug ?? null,
        currentTime: audio.currentTime,
        attempt: this._softAttempts,
      });
      try {
        const buf = audio.buffered;
        if (buf.length > 0) {
          const bufStart = buf.start(buf.length - 1);
          const bufEnd   = buf.end(buf.length - 1);
          // Only seek when we are behind the buffered range (in the gap).
          // Do not seek if we're already inside the buffered range — that
          // would be a backward jump and could cause the same seek-loop issue.
          if (audio.currentTime < bufStart && bufStart < bufEnd) {
            audio.currentTime = bufStart;
          }
          // If currentTime is already inside a buffered range, the stall is a
          // decode delay — the browser will resolve it. Release lock and wait.
        }
      } catch {}
      this._release(COOLDOWN_SOFT_MS);
      return;
    }

    // ── Escalation: full stream reload ────────────────────────────────────
    this._softAttempts = 0;
    this._hardReloads++;

    const isEntitled = isEntitledFullPlaybackTrack(state.currentTrack);

    if (this._hardReloads > MAX_HARD_RELOADS || !isEntitled) {
      // Exhausted all retries — surface the error
      logPlaybackResilience("stall-recovery", {
        source: "RecoveryCoordinator",
        code: "STALL_EXHAUSTED",
        slug: state.currentTrack?.slug ?? null,
        hardReloads: this._hardReloads,
        isEntitled,
      });
      ctx?.patchState?.({
        error: "Connection lost. Check your internet and tap to retry.",
        streamRetryable: true,
        isBuffering: false,
        playbackNetworkState: "error_stream",
      });
      this._release(COOLDOWN_HARD_MS);
      return;
    }

    logPlaybackResilience("stall-recovery", {
      source: "RecoveryCoordinator",
      code: "HARD_RELOAD",
      slug: state.currentTrack?.slug ?? null,
      hardReloads: this._hardReloads,
    });
    void ctx?.retryStreamPlaybackRef?.current?.();
    this._release(COOLDOWN_HARD_MS);
  }

  _release(cooldownMs) {
    this._locked        = false;
    this._cooldownUntil = Date.now() + cooldownMs;
  }
}

// Module-level singleton — one coordinator for the lifetime of the app
export const recoveryCoordinator = new RecoveryCoordinator();
