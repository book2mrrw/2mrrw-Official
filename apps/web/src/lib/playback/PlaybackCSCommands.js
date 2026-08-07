"use client";

import { waitAudioSrcReady, playAudioIfNotPaused } from "@/lib/audio/audio-element-utils";
import { normalizeTrack, resolvePlaybackPresentation } from "@/lib/playback/playback-track-utils";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";

/**
 * Attaches Group 3 (Cinematic Session mode) commands to the shared `self` service object.
 */
export function attachCSCommands(self) {
  self.applyCSModeToTrack = async function applyCSModeToTrack(track) {
    const {
      applyCsToElement, patchState, updateMediaSession,
      csModeRef, csUsingAlternateSrcRef, audioRef, skipPauseInterruptionRef, stateRef,
    } = self._deps;

    if (!csModeRef.current || !track) return;
    const normalized = normalizeTrack(track);
    const audio = audioRef.current;
    if (!audio) return;
    const presentation = resolvePlaybackPresentation(
      normalized,
      true,
      csUsingAlternateSrcRef.current
    );
    const nextTrack = {
      ...normalized,
      title: presentation.title,
      src: presentation.src,
      cover: presentation.cover,
    };
    const currentUrl = audio.currentSrc || audio.src;
    const targetUrl = new URL(nextTrack.src, window.location.href).href;
    if (currentUrl !== targetUrl) {
      skipPauseInterruptionRef.current = true;
      audio.pause();
      await waitAudioSrcReady(audio, nextTrack.src);
    }
    applyCsToElement(audio, presentation, audio.currentTime > 0 ? audio.currentTime : null);
    patchState({
      csTrack: normalized,
      currentTrack: nextTrack,
      currentTrackId: nextTrack.id,
    });
    void updateMediaSession(nextTrack, { playing: !audio.paused });
  };

  self.toggleCSMode = async function toggleCSMode() {
    const {
      patchState, updateMediaSession, applyCsToElement, syncPositionState,
      stateRef, audioRef, activeCommandRef, skipPauseInterruptionRef, pendingSeekRef,
      csModeRef, csUsingAlternateSrcRef,
    } = self._deps;

    const next = !csModeRef.current;
    csModeRef.current = next;

    const audio = audioRef.current;
    const track = stateRef.current.currentTrack;
    if (!audio || !track || !stateRef.current.hasStarted) {
      patchState({ csMode: next, csTrack: next && track ? normalizeTrack(track) : null });
      void updateMediaSession(track, { playing: stateRef.current.isPlaying });
      return next;
    }

    const normalized = stateRef.current.csTrack || normalizeTrack(track);
    const resumeAt = audio.currentTime;
    const presentation = resolvePlaybackPresentation(normalized, next, csUsingAlternateSrcRef.current);
    const nextTrack = {
      ...normalized,
      title: presentation.title,
      src: presentation.src,
      cover: presentation.cover,
    };

    const currentUrl = audio.currentSrc || audio.src;
    const targetUrl = new URL(nextTrack.src, window.location.href).href;
    const needsSrcSwap = currentUrl !== targetUrl;

    try {
      if (needsSrcSwap) {
        skipPauseInterruptionRef.current = true;
        audio.pause();
        await waitAudioSrcReady(audio, nextTrack.src);
        pendingSeekRef.current = resumeAt > 0 ? resumeAt : null;
      }
      applyCsToElement(audio, presentation, resumeAt > 0 ? resumeAt : null);
      patchState({
        csMode: next,
        csTrack: next ? normalized : null,
        currentTrack: nextTrack,
      });
      void updateMediaSession(nextTrack, { playing: !audio.paused });
      if (audio.paused && stateRef.current.isPlaying) {
        await playAudioIfNotPaused(audio, true, {
          command: "TOGGLE_CS_MODE",
          requestId: activeCommandRef.current?.requestId || null,
          state: stateRef.current,
          context: { source: "applyCSModeToTrack" },
        });
      }
      syncPositionState(true);
    } catch (error) {
      csModeRef.current = !next;
      patchState({ error: "Could not apply chopped & slowed mode.", csMode: !next });
      reportPlaybackDiagnostic({
        level: "warn",
        code: "CS_MODE_APPLY_FAILED",
        command: "TOGGLE_CS_MODE",
        requestId: activeCommandRef.current?.requestId || null,
        state: stateRef.current,
        error,
        context: {
          visibility: typeof document !== "undefined" ? document.visibilityState : null,
          source: stateRef.current?.source || null,
        },
      });
    }
    return next;
  };
}
