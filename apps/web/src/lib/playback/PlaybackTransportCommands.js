"use client";

import { playbackStateMachine } from "@/media/PlaybackStateMachine";
import { PLAYBACK_COMMANDS } from "@/lib/playback/playback-commands";
import {
  clearLibraryStreamSession,
  fetchLibraryStream,
  isLibraryStreamRedirectSrc,
  parseStreamSlugFromSrc,
  streamUrlNeedsRefresh,
} from "@/lib/playback/stream-client";
import {
  waitAudioSrcReady,
  playAudioIfNotPaused,
} from "@/lib/audio/audio-element-utils";
import {
  resumeWebAudioContextIfSuspended,
  ensureWebAudioRunning,
} from "@/lib/audio/web-audio-context-utils";
import { logPlayback } from "@/lib/observability/client-log";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";
import { sendControlSystemPlaybackEvent } from "@/lib/control-system/playback";
import { clearPersistedMediaSessionTrack } from "@/lib/media-session-artwork";
import { PREVIEW_HARD_CAP_SEC } from "@/lib/playback/PlaybackEventHandlers";

/**
 * Attaches Group 5 (transport control) commands to the shared `self` service object.
 */
export function attachTransportCommands(self) {
  self.pauseInternal = function pauseInternal(opts = {}) {
    const {
      tracePlayback, logDirectInternalCallViolation, clearViewportResume,
      audioRef, userPausedRef, userIntentPausedRef, pausedDuringCurrentLoadRef,
      viewportPauseRef, lastUserActionRef,
    } = self._deps;

    logDirectInternalCallViolation("pauseInternal");
    const fromViewport = Boolean(opts.fromViewport);
    const userInitiated = Boolean(opts.userInitiated);
    const interrupt = Boolean(opts.interrupt);

    if (userInitiated) {
      lastUserActionRef.current = "pause";
      clearViewportResume();
      userPausedRef.current = true;
      userIntentPausedRef.current = true;
      pausedDuringCurrentLoadRef.current = true;
    } else if (fromViewport) {
      viewportPauseRef.current = true;
    } else if (!interrupt) {
      userPausedRef.current = true;
    }

    tracePlayback("pauseInternal", "pauseInternal", { fromViewport, userInitiated, interrupt });
    audioRef.current?.pause();
  };

  self.pauseForViewport = function pauseForViewport() {
    const { patchState, tracePlayback, stateRef, audioRef, dispatchPlaybackCommandRef } = self._deps;
    const audio = audioRef.current;
    if (!audio || audio.paused) {
      if (stateRef.current.isPlaying) {
        patchState({ isPlaying: false, playbackState: "paused" });
      }
      return;
    }
    tracePlayback("pauseForViewport", "pauseForViewport");
    void dispatchPlaybackCommandRef.current?.(PLAYBACK_COMMANDS.VIEWPORT_PAUSE, {}, { serial: false });
  };

  self.resumeInternal = async function resumeInternal() {
    const {
      patchState, updateMediaSession, finalizeStreamSession, initWebAudio,
      tracePlayback, logDirectInternalCallViolation,
      attemptLightweightPlaybackResume,
      stateRef, audioRef, audioCtxRef, audibilitySampleRef, activeCommandRef,
      userPausedRef, userIntentPausedRef, pausedDuringCurrentLoadRef,
      lastUserActionRef, streamMetaRef, activeStreamAbortRef,
    } = self._deps;

    logDirectInternalCallViolation("resumeInternal");
    const audio = audioRef.current;
    const track = stateRef.current.currentTrack;
    if (!audio || !track) return false;

    // Session restore: audio element has no source — track was restored to UI state but
    // playback never started. Route through the full play pipeline so src gets loaded
    // and position is restored from position memory.
    if (!audio.src || audio.src === window.location.href) {
      return self.playTrackInternal(track);
    }

    tracePlayback("resumeInternal", "resumeInternal", { slug: track.slug });
    lastUserActionRef.current = "play";
    userPausedRef.current = false;
    userIntentPausedRef.current = false;
    // Clear the user-pause flags so the buffer gate in any in-flight playTrackInternal
    // (e.g. triggered by auto-advance) knows the user now wants to be playing.
    pausedDuringCurrentLoadRef.current = false;

    try {
      // dispatchPlaybackCommand plays a silent WAV element synchronously before any await,
      // granting page-wide iOS media autoplay permission that persists for all subsequent
      // audio.play() calls — so no play-then-pause unlock cycle is needed here.
      // initWebAudio + ctx.resume() complete the AudioContext (Web Audio graph) unlock path,
      // which is separate from the HTMLMediaElement permission on iOS Safari.
      initWebAudio();
      const iosGestureCtx = audioCtxRef.current;
      if (iosGestureCtx && iosGestureCtx.state !== "running") {
        iosGestureCtx.resume().catch(() => {}); // fire-and-forget: iOS gesture captured here
      }
      await resumeWebAudioContextIfSuspended(audioCtxRef);
      if (!(await ensureWebAudioRunning(audioCtxRef))) {
        const lightOk = await attemptLightweightPlaybackResume("resume_ctx_suspended");
        await resumeWebAudioContextIfSuspended(audioCtxRef, "resume-after-light");
        if (!(await ensureWebAudioRunning(audioCtxRef))) {
          reportPlaybackDiagnostic({
            level: "warn",
            code: "WEB_AUDIO_SUSPENDED_BLOCKED_RESUME",
            command: PLAYBACK_COMMANDS.RESUME,
            requestId: activeCommandRef.current?.requestId || null,
            state: stateRef.current,
            context: { lightResumeOk: lightOk },
          });
          patchState({
            isPlaying: false,
            error: "Tap play to continue.",
            playbackState: "paused",
          });
          return false;
        }
      }
      const played = await playAudioIfNotPaused(audio, true, {
        command: PLAYBACK_COMMANDS.RESUME,
        requestId: activeCommandRef.current?.requestId || null,
        state: stateRef.current,
        context: { source: "resumeInternal" },
      });
      if (!played || audio.paused) {
        patchState({
          isPlaying: false,
          error: "Audio playback failed. Try again in a moment.",
          playbackState: "paused",
        });
        return false;
      }
      if (track) void updateMediaSession(track, { playing: !audio.paused });
      patchState({
        error: null,
        accessDenied: false,
        hasStarted: true,
      });

      const meta = streamMetaRef.current;
      const slug = meta?.slug || parseStreamSlugFromSrc(track.src) || track.slug;
      if (slug && meta && streamUrlNeedsRefresh(meta) && !isLibraryStreamRedirectSrc(meta.url)) {
        const refreshTrackSlug = track?.slug;
        void (async () => {
          try {
            const data = await fetchLibraryStream(slug, { force: false });
            // Bail if the user skipped to a different track while the URL refresh was in flight.
            if (stateRef.current.currentTrack?.slug !== refreshTrackSlug) return;
            streamMetaRef.current = {
              ...meta,
              url: data.url,
              fetchedAt: Date.now(),
              expiresIn: data.expiresIn || 3600,
              streamEventId: data.streamEventId || meta.streamEventId,
              sessionId: data.sessionId || meta.sessionId,
            };
            const resumeAt = audio.currentTime || 0;
            // Capture playing state BEFORE waitAudioSrcReady — that function calls
            // audio.load() which pauses the element, so checking !audio.paused after
            // the await always returns false and play() would never be called.
            const wasPlaying = !audio.paused;
            // Guard: only set skipPauseInterruptionRef when the element is currently
            // playing. audio.load() fires a "pause" event ONLY when transitioning from
            // non-paused → paused. If the element is already paused, no "pause" event
            // fires and the flag is never consumed, leaking into the next user tap —
            // silently swallowing it (the modal auto-play starts-then-stops bug).
            // Pattern mirrors FIX 2 (PlaybackStreamCommands.js:122) and FIX 15 (line 513).
            if (!audio.paused) self._deps.skipPauseInterruptionRef.current = true;
            await waitAudioSrcReady(audio, data.url, { signal: activeStreamAbortRef.current?.signal });
            // Check again after the async src-ready wait
            if (stateRef.current.currentTrack?.slug !== refreshTrackSlug) return;
            if (resumeAt > 0) {
              const seekAfterLoad = () => {
                if (resumeAt > 0 && isFinite(audio.duration)) {
                  audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
                }
              };
              if (isFinite(audio.duration) && audio.duration > 0) {
                seekAfterLoad();
              } else {
                audio.addEventListener("loadedmetadata", seekAfterLoad, { once: true });
              }
            }
            if (wasPlaying || stateRef.current.isPlaying) await playAudioIfNotPaused(audio, stateRef.current.isPlaying);
          } catch (error) {
            reportPlaybackDiagnostic({
              level: "warn",
              code: "RESUME_STREAM_REFRESH_FAILED",
              command: PLAYBACK_COMMANDS.RESUME,
              requestId: activeCommandRef.current?.requestId || null,
              state: stateRef.current,
              error,
              context: {
                visibility: typeof document !== "undefined" ? document.visibilityState : null,
                source: stateRef.current?.source || null,
              },
            });
          }
        })();
      }

      return true;
    } catch (err) {
      if (err?.code === "ACCESS_DENIED") {
        const meta = streamMetaRef.current;
        if (meta) finalizeStreamSession(meta, { completed: false, durationSeconds: audio.currentTime || 0 });
        patchState({
          isPlaying: false,
          accessDenied: true,
          error: "Access unavailable",
          playbackState: "paused",
        });
        return false;
      }
      patchState({ isPlaying: false, error: "Audio playback failed. Try again in a moment.", playbackState: "paused" });
      return false;
    }
  };

  self.seekInternal = function seekInternal(time) {
    const {
      syncProgressTime, syncPositionState, tracePlayback, logDirectInternalCallViolation, cancelCrossfade,
      stateRef, audioRef, pendingSeekRef,
    } = self._deps;

    logDirectInternalCallViolation("seekInternal");
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    cancelCrossfade();
    tracePlayback("seekInternal", "seekInternal", { time });
    const track = stateRef.current.currentTrack;
    let capped = time;
    if (track?.metadata?.access?.previewOnly) {
      capped = Math.min(time, PREVIEW_HARD_CAP_SEC);
    }
    if (audio.readyState < 1 || stateRef.current.playbackState === "loading") {
      pendingSeekRef.current = Math.max(0, capped);
      syncProgressTime(pendingSeekRef.current);
      return;
    }
    audio.currentTime = Math.max(0, Math.min(capped, isFinite(audio.duration) ? audio.duration : capped));
    syncProgressTime(audio.currentTime);
    syncPositionState(true);
    if (stateRef.current.currentTrack) {
      sendControlSystemPlaybackEvent(stateRef.current.currentTrack, "seek", {
        mediaType: "audio",
        positionSeconds: audio.currentTime,
        durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
      });
    }
  };

  self.seekBack = function seekBack(seconds = 15) {
    const audio = self._deps.audioRef.current;
    if (!audio) return;
    self.seekInternal(Math.max(0, (audio.currentTime || 0) - seconds));
  };

  self.seekForward = function seekForward(seconds = 15) {
    const audio = self._deps.audioRef.current;
    if (!audio) return;
    const max = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (audio.currentTime || 0) + seconds;
    self.seekInternal(Math.min(max, (audio.currentTime || 0) + seconds));
  };

  self.setPlaybackRateInternal = function setPlaybackRateInternal(rate) {
    const { tracePlayback, logDirectInternalCallViolation, audioRef } = self._deps;
    logDirectInternalCallViolation("setPlaybackRateInternal");
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(rate) || rate <= 0) return;
    tracePlayback("setPlaybackRateInternal", "setPlaybackRateInternal", { rate });
    audio.playbackRate = rate;
    if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
    if (typeof audio.webkitPreservePitch !== "undefined") audio.webkitPreservePitch = true;
  };

  self.resumeTrackAtPosition = async function resumeTrackAtPosition(trackId, position) {
    const { stateRef, audioRef } = self._deps;
    const track = stateRef.current.currentTrack;
    if (!track || !stateRef.current.hasStarted) return false;
    const normalizedId = trackId != null ? String(trackId) : "";
    const matches =
      normalizedId &&
      (normalizedId === String(track.id || "") ||
        normalizedId === String(track.trackId || "") ||
        normalizedId === String(track.slug || ""));
    if (!matches) return false;

    const audio = audioRef.current;
    if (!audio) return false;

    const targetPos = Math.max(0, Number(position) || 0);
    if (Number.isFinite(targetPos) && Math.abs((audio.currentTime || 0) - targetPos) > 0.25) {
      self.seekInternal(targetPos);
    }

    if (!audio.paused) return true;
    return self.resumeInternal();
  };

  self.resumeFromViewport = async function resumeFromViewport() {
    const { audioRef, stateRef, viewportResumeInFlightRef, isInAudioVisualViewportRef, lastTrackIdRef, clearViewportResume } = self._deps;
    if (viewportResumeInFlightRef.current) return false;
    if (isInAudioVisualViewportRef.current) return false;

    const trackId = lastTrackIdRef.current;
    const audio = audioRef.current;
    const position = audio?.currentTime ?? stateRef.current.currentTime ?? 0;

    viewportResumeInFlightRef.current = true;
    try {
      const ok =
        trackId != null
          ? await self.resumeTrackAtPosition(trackId, position)
          : await self.resumeInternal();
      if (ok) {
        self._deps.lastUserActionRef.current = "play";
        clearViewportResume();
      }
      return ok;
    } finally {
      viewportResumeInFlightRef.current = false;
    }
  };

  self.stopInternal = function stopInternal() {
    const {
      tracePlayback, finalizeStreamSession, stopPositionSaveTimer,
      stopProgressRaf, stopKeepAlivePing, clearViewportResume,
      stateRef, audioRef, streamMetaRef, activeStreamAbortRef,
      hlsEngineRef, skipPauseInterruptionRef, lastUserActionRef, userPausedRef,
      queueRef, queueIndexRef, csModeRef, csUsingAlternateSrcRef,
    } = self._deps;

    tracePlayback("stopInternal", "stopInternal");
    lastUserActionRef.current = "stop";
    clearViewportResume();
    userPausedRef.current = true;
    const audio = audioRef.current;
    const meta = streamMetaRef.current;
    if (meta) {
      finalizeStreamSession(meta, {
        completed: false,
        durationSeconds: audio?.currentTime || 0,
      });
      void clearLibraryStreamSession(meta.slug, meta.sessionId);
    }
    stopProgressRaf();
    stopPositionSaveTimer();
    stopKeepAlivePing();
    if (audio) {
      skipPauseInterruptionRef.current = true;
      audio.pause();
      if (hlsEngineRef.current) {
        hlsEngineRef.current.detach();
        hlsEngineRef.current = null;
      }
      audio.removeAttribute("src");
      audio.load();
    }
    csModeRef.current = false;
    csUsingAlternateSrcRef.current = false;
    if (activeStreamAbortRef.current) {
      activeStreamAbortRef.current.abort();
      activeStreamAbortRef.current = null;
    }
    streamMetaRef.current = null;
    // Reset SM context to initial values — fires all channels (context/transport/progress/identity).
    playbackStateMachine.resetContext();
    queueRef.current = [];
    queueIndexRef.current = -1;
    clearPersistedMediaSessionTrack();
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  };
}
