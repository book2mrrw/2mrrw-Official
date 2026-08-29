"use client";

import {
  playbackStateMachine,
  PLAYBACK_ORCHESTRATION_EVENTS,
} from "@/media/PlaybackStateMachine";
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
import { PhysicalEffectAuthorityMode } from "@/lib/audio/physical-effect-authority";
import {
  captureTransportObservationContext,
  markPhysicalObservationContext,
  reportTransportMode,
} from "@/lib/playback/transport-observation-port.js";

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
    const pauseElement = audioRef.current;
    if (pauseElement) {
      markPhysicalObservationContext(
        pauseElement,
        "pause",
        captureTransportObservationContext({
          mediaIdentity:
            self._deps.stateRef.current?.currentTrack?.id ??
            self._deps.stateRef.current?.currentTrack?.trackId ??
            self._deps.stateRef.current?.currentTrack?.slug ?? null,
          requestId: self._deps.activeCommandRef.current?.requestId ?? null,
          source: "pauseInternal",
        }),
      );
      pauseElement.pause();
    }

    // When stall recovery has already paused the audio element, audio.pause() is a
    // no-op that fires no 'pause' event — so onPause never runs and the SM is never
    // updated. A user-initiated pause must always win. Schedule a microtask that fires
    // after any synchronous 'pause' event handlers; if isPlaying is still true then,
    // force SM and UI state into alignment directly.
    if (userInitiated) {
      queueMicrotask(() => {
        const { audioRef: aRef, stateRef: sRef, patchState: ps } = self._deps;
        if (aRef.current?.paused && sRef.current?.isPlaying) {
          ps({ isPlaying: false, playbackNetworkState: "idle", isBuffering: false });
          playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.PLAY_PAUSE);
        }
      });
    }
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

  self.resumeInternal = async function resumeInternal(effectContext = {}) {
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

    // Session restore or HLS blob revocation: audio element has no usable source.
    // Common cause: HLS.js revokes the MediaSource blob URL during stall recovery or
    // engine detach while audio is paused, leaving audio.src === window.location.href.
    // Preserve the last-known SM position so the forced reload resumes at the right
    // point instead of restarting from 0:00.
    if (!audio.src || audio.src === window.location.href) {
      const resumeAt = (stateRef.current?.currentTime ?? 0) > 0
        ? stateRef.current.currentTime
        : undefined;
      return self.playTrackInternal(track, {
        ...(resumeAt !== undefined ? { resumeAt } : {}),
        ...effectContext,
      });
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
        const lightOk = await attemptLightweightPlaybackResume("resume_ctx_suspended", effectContext);
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
      // Pre-play URL refresh: if the stream URL is about to expire (or already has),
      // refresh it while the audio element is still paused. audio.load() on a paused
      // element fires no "pause" event, so skipPauseInterruptionRef is not needed here
      // and there is no play→load→play stutter. If the refresh fails, we fall through
      // and attempt playback with the existing URL.
      const meta = streamMetaRef.current;
      const slug = meta?.slug || parseStreamSlugFromSrc(track.src) || track.slug;
      if (slug && meta && streamUrlNeedsRefresh(meta) && !isLibraryStreamRedirectSrc(meta.url)) {
        try {
          const savedPosition = audio.currentTime || 0;
          const data = await fetchLibraryStream(slug, { force: false });
          if (stateRef.current.currentTrack?.slug !== track.slug) return false;
          streamMetaRef.current = {
            ...meta,
            url: data.url,
            fetchedAt: Date.now(),
            expiresIn: data.expiresIn || 3600,
            streamEventId: data.streamEventId || meta.streamEventId,
            sessionId: data.sessionId || meta.sessionId,
          };
          // audio is paused here — audio.load() fires no pause event, no stutter
          await waitAudioSrcReady(audio, data.url, { signal: activeStreamAbortRef.current?.signal });
          if (stateRef.current.currentTrack?.slug !== track.slug) return false;
          if (savedPosition > 0) {
            const seekToSaved = () => {
              if (savedPosition > 0 && isFinite(audio.duration)) {
                audio.currentTime = Math.min(savedPosition, Math.max(0, audio.duration - 0.25));
              }
            };
            if (isFinite(audio.duration) && audio.duration > 0) {
              seekToSaved();
            } else {
              audio.addEventListener("loadedmetadata", seekToSaved, { once: true });
            }
          }
        } catch (refreshErr) {
          reportPlaybackDiagnostic({
            level: "warn",
            code: "RESUME_PRE_REFRESH_FAILED",
            command: PLAYBACK_COMMANDS.RESUME,
            requestId: activeCommandRef.current?.requestId || null,
            state: stateRef.current,
            error: refreshErr,
            context: {
              visibility: typeof document !== "undefined" ? document.visibilityState : null,
              source: stateRef.current?.source || null,
            },
          });
          // Fall through — attempt playback with the existing URL
        }
      }

      const played = await playAudioIfNotPaused(audio, true, {
        command: PLAYBACK_COMMANDS.RESUME,
        requestId: activeCommandRef.current?.requestId || null,
        state: stateRef.current,
        context: { source: "resumeInternal" },
        effectAuthorityMode:
          effectContext.effectAuthorityMode ?? PhysicalEffectAuthorityMode.CORE_CURRENT,
        effectGuardRequired: effectContext.effectGuardRequired === true,
        effectAuthority: effectContext.effectAuthority ?? null,
        canApplyEffect: effectContext.canApplyEffect,
        mediaIdentity: track.id ?? track.slug ?? null,
      });
      if (played === null) return false;
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
      syncProgressTime, syncPositionState, tracePlayback, logDirectInternalCallViolation,
      stateRef, audioRef, pendingSeekRef,
    } = self._deps;

    logDirectInternalCallViolation("seekInternal");
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
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
    reportTransportMode({ playbackRate: rate });
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
