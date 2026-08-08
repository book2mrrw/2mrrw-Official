"use client";

import { playbackStateMachine, PLAYBACK_ORCHESTRATION_EVENTS } from "@/media/PlaybackStateMachine";
import { PLAYBACK_COMMANDS } from "@/lib/playback/playback-commands";
import { MARKS, perfMark, recordAudioContextState, PLAYBACK_SCENARIOS } from "@/lib/dev/performanceMarks";
import { writeAvailabilityCache } from "@/lib/media/availability-cache";
import {
  clearLibraryStreamSession,
  fetchLibraryStream,
  isLibraryStreamRedirectSrc,
  isLibraryStreamSrc,
  parseStreamSlugFromSrc,
  parseStreamTrackSlugFromSrc,
  streamUrlNeedsRefresh,
} from "@/lib/playback/stream-client";
import {
  normalizePlaybackSrc,
  clampRestorePosition,
  waitAudioSrcReady,
  warmupSignedStreamPreload,
  loadAudioSrcAndPlay,
  playAudioIfNotPaused,
  getTrackPreviewSrc,
  RESTORE_MIN_POSITION_SEC,
  AUDIO_SRC_READY_TIMEOUT_MS,
} from "@/lib/audio/audio-element-utils";
import {
  resumeWebAudioContextIfSuspended,
  ensureWebAudioRunning,
} from "@/lib/audio/web-audio-context-utils";
import { isAudioActuallyAudible } from "@/lib/playback/audibility";
import {
  canFallbackStreamToPreview,
  normalizeTrack,
  resolvePlaybackPresentation,
} from "@/lib/playback/playback-track-utils";
import { isAdminAccount } from "@/lib/music-access";
import { logPlayback } from "@/lib/observability/client-log";
import { logStateChurn } from "@/lib/diagnostics/state-churn-log";
import { isPlaybackTraceEnabled, logStreamLifecycle, logPlaybackEvent } from "@/lib/diagnostics/playback-trace";
import { isUiHydrationTraceEnabled, logUiHydrationTrace } from "@/lib/diagnostics/ui-hydration-trace";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";
import { sendControlSystemPlaybackEvent } from "@/lib/control-system/playback";
import { classifySourceUrl, isDirectlyBufferable } from "@/lib/playback/audio-source-resolver";
import { clearPlaybackPosition, getSavedPlaybackPosition } from "@/lib/playback/position-memory";
import { notifyMediaEngineBridge } from "@/media/mediaEngineBridge";
import { preloadCoverImage } from "@/lib/media/preload";
import { getHLSEngine } from "@/lib/audio/HLSEngine";
import { getQualityLevel as getHLSQualityLevel } from "@/lib/audio/network-quality";
import { getResolvedCdnUrl } from "@/lib/playback/redirect-resolve-cache";
import { preloadCsAssets } from "@/lib/audio/cs-assets";
import { isSamePlaybackTrack } from "@/lib/music-playback";
import {
  PREVIEW_HARD_CAP_SEC,
  SPURIOUS_ENDED_GUARD_MS,
} from "@/lib/playback/PlaybackEventHandlers";

/**
 * Attaches Group 1 (core stream play) commands to the shared `self` service object.
 * All commands read live deps via self._deps at call time — no stale closure captures.
 */
export function attachStreamCommands(self) {
  self.playTrackInternal = async function playTrackInternal(track, options = {}) {
    const {
      patchState, patchTransport, updateMediaSession, applyCsToElement,
      recordLocalListening, resolveLibraryStreamForTrack, finalizeStreamSession,
      initWebAudio, unlockAudioFromGesture, cancelCrossfade, scheduleCrossfadeHandoff, tracePlayback,
      logDirectInternalCallViolation, attemptLightweightPlaybackResume,
      getPlaybackTransportHealth, isLifecycleRecoverySuppressed, clearContinuityFreeze,
      syncProgressTime,
      stateRef, audioRef, audioCtxRef, mainGainRef, userGainRef, crossfadeStateRef,
      activeCommandRef, activeStreamAbortRef, streamMetaRef, streamErrorRetriedRef,
      stallHardAttemptRef, previewFadeInitRef, userPausedRef, userIntentPausedRef,
      skipPauseInterruptionRef, lifecycleRecoveryLockRef, queueRef, queueIndexRef,
      csModeRef, csUsingAlternateSrcRef, audibilitySampleRef, playRequestIdRef,
      nextTrackPreloadRef, streamSwapPreloadRef, intentPrewarmRef,
      nextTrackSignedUrlCacheRef, sessionUnlockedRef, entitlementAccountStateRef,
      listeningUserIdRef, lastPlayedSlugRef, pendingSeekRef, hlsEngineRef,
      authLoadingRef, csImgRef, csVidRef, csAudioRef, pausedDuringCurrentLoadRef,
      spuriousEndedGuardRef, lastUserActionRef,
    } = self._deps;

    logDirectInternalCallViolation("playTrackInternal");
    perfMark(MARKS.PLAYBACK_REQUEST);
    userIntentPausedRef.current = false;
    const requestId = playRequestIdRef.current + 1;
    playRequestIdRef.current = requestId;
    // Cancel any active crossfade state UNLESS this is the auto-advance that created the
    // bridge — in that case the preload element is already audible and we must keep the
    // bridge alive until the main element is loaded and the gain handoff completes.
    // For all user-initiated plays we always cancel immediately so mainGain is restored.
    if (crossfadeStateRef.current !== "idle" &&
        (crossfadeStateRef.current !== "bridging" || !options.isBridgeAdvance)) {
      cancelCrossfade();
    }
    if (!options.preserveActiveStream && activeStreamAbortRef.current) {
      logStreamLifecycle("abort", { source: "playTrackInternal", slug: track?.slug });
      activeStreamAbortRef.current.abort();
    }
    const streamAbortController = new AbortController();
    activeStreamAbortRef.current = streamAbortController;
    const audioEl = audioRef.current;
    // For redirect fast-path (same-origin proxy → S3), pause immediately so
    // the 300ms fade-out below is avoided.  For progressive-only users also
    // assign src early so the browser fetch overlaps with Web Audio setup.
    // HLS-eligible tracks skip the src/load — hls.js attaches via MSE and
    // sets its own blob: src; an early redirect src causes double-init where
    // the browser starts the redirect fetch then abandons it for MSE, producing
    // the "plays → buffers → plays again" symptom.
    // willAttemptHLS: HLS will set its own MSE blob: src via hls.attachMedia().
    // Skipping audioEl.load() prevents the redirect URL from pre-buffering enough
    // data to cause an audible "plays → silence → plays again" double-init on desktop.
    // We still assign audioEl.src so unlockAudioFromGesture's play() has a valid
    // src on iOS — play() with no src throws and leaves the audio context locked.
    const willAttemptHLS = Boolean(track?.metadata?.access?.canStream) &&
      isLibraryStreamRedirectSrc(track?.src || "");
    if (isLibraryStreamRedirectSrc(track?.src) && audioEl) {
      const earlyNorm = normalizePlaybackSrc(track.src);
      if (earlyNorm && normalizePlaybackSrc(audioEl.src || "") !== earlyNorm) {
        skipPauseInterruptionRef.current = true;
        audioEl.pause();
        audioEl.src = track.src;
        if (!willAttemptHLS) {
          audioEl.load();
        }
      }
    } else if (track?.src && audioEl) {
      // CDN/Preview fast-path: early src assignment so the browser fetch overlaps
      // with Web Audio setup, mirroring the redirect fast-path above.
      const srcKind = classifySourceUrl(track.src);
      if (isDirectlyBufferable(srcKind)) {
        const earlyNorm = normalizePlaybackSrc(track.src);
        if (earlyNorm && normalizePlaybackSrc(audioEl.src || "") !== earlyNorm) {
          if (!audioEl.paused) {
            skipPauseInterruptionRef.current = true;
            audioEl.pause();
          }
          audioEl.src = track.src;
          audioEl.load();
        }
      }
    }
    if (audioEl?.paused && !sessionUnlockedRef.current) {
      await unlockAudioFromGesture(audioEl);
      // Unlock the crossfade pre-buffer element at the same time so iOS allows
      // play() on it when the crossfade triggers (no second user gesture available).
      const nextEl = nextTrackPreloadRef.current;
      if (nextEl) await unlockAudioFromGesture(nextEl);
    }

    initWebAudio();
    await resumeWebAudioContextIfSuspended(audioCtxRef, "playTrack-entry");
    recordAudioContextState(audioCtxRef.current, "playTrack-resume");
    if (isPlaybackTraceEnabled()) {
      logPlaybackEvent({
        type: "play-chain:ctx-entry",
        source: "playTrackInternal",
        extra: {
          requestId,
          slug: track?.slug,
          ctxState: audioCtxRef.current?.state ?? "none",
          sessionUnlocked: sessionUnlockedRef?.current,
          audioSrc: audio?.src ? audio.src.slice(0, 80) : null,
          readyState: audio?.readyState,
          audioElement: Boolean(audio),
        },
      });
    }
    if (!(await ensureWebAudioRunning(audioCtxRef))) {
      const lightOk = await attemptLightweightPlaybackResume("playTrack_ctx_suspended");
      await resumeWebAudioContextIfSuspended(audioCtxRef, "playTrack-after-light");
      if (!(await ensureWebAudioRunning(audioCtxRef))) {
        const transportIntact = getPlaybackTransportHealth().intact;
        if (!transportIntact) {
          await playbackStateMachine.transition(
            PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED,
            { reason: "audio_context_suspended", resumeAfter: true }
          );
        }
        reportPlaybackDiagnostic({
          level: "warn",
          code: "WEB_AUDIO_SUSPENDED_BLOCKED_PLAY",
          command: PLAYBACK_COMMANDS.PLAY_TRACK,
          requestId,
          state: stateRef.current,
          context: {
            lifecycleRecoveryLock: lifecycleRecoveryLockRef.current,
            lifecycleSuppressed: isLifecycleRecoverySuppressed("audio_context_suspended"),
            lightResumeOk: lightOk,
            transportIntact,
          },
        });
        patchState({
          isPlaying: false,
          error: "Tap play to continue.",
          playbackState: "paused",
          playbackNetworkState: transportIntact ? "idle" : "recovering",
        });
        cancelCrossfade();
        return false;
      }
    }
    self._deps.patchUI({ previewEnded: false });
    if (!track || (typeof track !== "object")) {
      console.error("[AudioContext] playTrack: invalid track", track);
      return false;
    }
    const normalized = normalizeTrack(track);
    // Auto-advance (QUEUE_AUTO_ADVANCE) must NOT clear the user's pause intent.
    // If the user pressed pause and then Track A ended triggering auto-advance to
    // Track B, we should NOT start playing Track B. Only user-initiated plays
    // (explicit track selection, skip, etc.) should reset this flag.
    // resumeInternal also resets it when the user explicitly unpauses.
    if (options?.playbackScenario !== PLAYBACK_SCENARIOS.QUEUE_AUTO_ADVANCE) {
      pausedDuringCurrentLoadRef.current = false;
    }
    lastUserActionRef.current = "track_change";
    self._deps.clearViewportResume();
    tracePlayback("trackChange", "playTrackInternal", {
      requestId,
      slug: normalized.slug,
      trackId: normalized.id,
    });
    if (!normalized.slug && !normalized.id && !normalized.src) {
      console.error("[AudioContext] playTrack: track missing identity and src", track);
      return false;
    }
    const presentation = resolvePlaybackPresentation(normalized, csModeRef.current, csUsingAlternateSrcRef.current);
    let nextTrack = {
      ...normalized,
      title: presentation.title,
      src: presentation.src,
      cover: presentation.cover,
    };

    const coverToPreload = nextTrack.cover || nextTrack.baseCover;
    const coverPreloadOptions = { coverArtType: nextTrack.coverArtType };
    const scheduleCoverPreload = () => {
      preloadCoverImage(coverToPreload, coverPreloadOptions);
    };
    const isMobileViewport =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(max-width: 768px)")?.matches ||
        /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ""));

    perfMark(MARKS.AUDIO_START_LATENCY_START);
    logPlayback("play_track", { trackId: nextTrack.id, source: nextTrack.source });
    const audio = audioRef.current;
    if (!audio) {
      console.error("[AudioContext] playTrack: audio element not mounted");
      patchState({
        currentTrackId: nextTrack.id || null,
        currentTrack: nextTrack,
        source: nextTrack.source,
        isPlaying: false,
        error: "Audio player unavailable.",
        hasStarted: false,
        playbackState: "idle",
      });
      return false;
    }
    if (!nextTrack.src) {
      console.error("[AudioContext] playTrack: no playback src", {
        slug: nextTrack.slug,
        id: nextTrack.id,
      });
      patchState({
        currentTrackId: nextTrack.id || null,
        currentTrack: nextTrack,
        source: nextTrack.source,
        isPlaying: false,
        error: "Audio source unavailable.",
        hasStarted: false,
        playbackState: "idle",
      });
      return false;
    }

    if (!isMobileViewport && coverToPreload) {
      scheduleCoverPreload();
    } else if (isMobileViewport && coverToPreload) {
      audio.addEventListener("canplay", scheduleCoverPreload, { once: true });
    }

    stallHardAttemptRef.current = 0;
    streamErrorRetriedRef.current = 0;

    const streamSlug = parseStreamSlugFromSrc(nextTrack.src) || nextTrack.slug;
    const usesLibraryStream = isLibraryStreamSrc(nextTrack.src);
    const redirectFastPath = isLibraryStreamRedirectSrc(nextTrack.src);
    const previewSrc = getTrackPreviewSrc(nextTrack);

    let syncSrc = nextTrack.src;
    let backgroundStreamResolve = false;

    const applyStreamResolveError = (err) => {
      if (requestId !== playRequestIdRef.current) return;
      if (err?.name === "AbortError") return;
      const canFallbackToPreview = canFallbackStreamToPreview(err, nextTrack);
      if (canFallbackToPreview && !isAdminAccount(entitlementAccountStateRef.current)) {
        console.warn("[AudioContext] stream fetch denied; falling back to preview", {
          slug: nextTrack.slug,
          trackId: nextTrack.id,
          status: err?.status,
        });
        const previewFallbackSrc =
          getTrackPreviewSrc(nextTrack) ||
          nextTrack?.metadata?.previewSrc ||
          nextTrack?.preview ||
          null;
        if (previewFallbackSrc) {
          skipPauseInterruptionRef.current = true;
          void loadAudioSrcAndPlay(audio, previewFallbackSrc).then((played) => {
            if (requestId !== playRequestIdRef.current) return;
            patchState({
              isPlaying: false,
              error: played ? null : "Preview unavailable",
              source: "preview",
              playbackState: played ? "preview_fallback" : "idle",
              playbackNetworkState: played ? "playing" : "error_stream",
              hasStarted: played,
              currentTrack: {
                ...nextTrack,
                src: previewFallbackSrc,
                metadata: {
                  ...(nextTrack.metadata || {}),
                  access: {
                    ...(nextTrack.metadata?.access || {}),
                    previewOnly: true,
                  },
                },
              },
            });
          });
          return;
        }
      }
      if (err?.code === "ACCESS_DENIED") {
        const prevMeta = streamMetaRef.current;
        if (prevMeta) finalizeStreamSession(prevMeta, { completed: false, durationSeconds: audio.currentTime || 0 });
        stallHardAttemptRef.current = 0;
        streamErrorRetriedRef.current = 0;
        skipPauseInterruptionRef.current = true;
        audio.pause();
        patchState({
          isPlaying: false,
          accessDenied: true,
          streamRetryable: false,
          error: "Access unavailable",
          hasStarted: false,
          playbackNetworkState: "error_stream",
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
        });
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
        return;
      }
      if (err?.code === "CONCURRENT_STREAM") {
        patchState({
          streamConflict: {
            slug: streamSlug,
            sessionId: err.sessionId || null,
            track: nextTrack,
            resumeAt: options.resumeAt,
          },
          hasStarted: false,
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
        });
        return;
      }
      patchState({
        isPlaying: false,
        error: "Stream unavailable — tap to retry",
        streamRetryable: true,
        hasStarted: false,
        playbackNetworkState: "error_stream",
        currentTrack: nextTrack,
        currentTrackId: nextTrack.id,
      });
    };

    if (usesLibraryStream && streamSlug) {
      const entitledFullStream = Boolean(nextTrack.metadata?.access?.canStream);
      if (previewSrc && !entitledFullStream) {
        syncSrc = previewSrc;
      } else if (entitledFullStream) {
        if (redirectFastPath) {
          // The redirect URL is the playable proxy — auth and entitlement are
          // re-validated server-side per request. Start audio immediately; session
          // creation resolves in the background.
          syncSrc = nextTrack.src;
          backgroundStreamResolve = true;
          // Seed slug-only meta so finalizeStreamSession can send analytics via
          // the server-side slug-based fallback (redirect plays never get a streamEventId).
          if (!streamMetaRef.current?.streamEventId && !streamMetaRef.current?.sessionId) {
            streamMetaRef.current = { slug: streamSlug };
          }
          // Fast-path 1: resolved CDN URL from a prior play of this same track —
          // skips the 302 round-trip entirely. Key is compound (albumSlug:trackSlug)
          // to avoid cache collisions between tracks in the same album.
          const fp1TrackSlug = parseStreamTrackSlugFromSrc(nextTrack.src) || nextTrack.metadata?.trackSlug || null;
          const fp1CacheKey = fp1TrackSlug ? `${streamSlug}:${fp1TrackSlug}` : streamSlug;
          const cachedCdnUrl = getResolvedCdnUrl(fp1CacheKey);
          if (cachedCdnUrl) {
            syncSrc = cachedCdnUrl;
            backgroundStreamResolve = false;
          }
          // Fast-path 2: if the preload element already followed the proxy redirect
          // and has buffered the CDN URL, use it directly on the main element.
          // Validated against the current track's slug+trackSlug to ensure the
          // preload element was loading THIS track, not the previous or next one.
          const preloadElForRedirect = nextTrackPreloadRef.current;
          const preloadCdnUrl = preloadElForRedirect?.currentSrc || "";
          const preloadSrc = preloadElForRedirect?.src || "";
          const fp2TrackSlug = parseStreamTrackSlugFromSrc(preloadSrc);
          const fp2AlbumSlug = parseStreamSlugFromSrc(preloadSrc);
          const fp2TrackMatch = fp1TrackSlug ? fp2TrackSlug === fp1TrackSlug : true;
          // Default false when album slug unknown — ambiguous src must not be reused
          // as a different album's preload and corrupt playback with the wrong track bytes.
          const fp2AlbumMatch = fp2AlbumSlug ? fp2AlbumSlug === streamSlug : false;
          if (
            preloadCdnUrl &&
            preloadElForRedirect.readyState >= 2 &&
            !isLibraryStreamSrc(preloadCdnUrl) &&
            fp2TrackMatch &&
            fp2AlbumMatch
          ) {
            syncSrc = preloadCdnUrl;
            backgroundStreamResolve = false;
          }
          // Fast-path 3: intent prewarm element has CDN bytes from a hover/touchstart
          // gesture (intentPrewarmRef). Same slug-match validation as fast-path 2.
          if (backgroundStreamResolve) {
            const intentEl = intentPrewarmRef.current;
            const intentCdnUrl = intentEl?.currentSrc || "";
            const intentSrc = intentEl?.src || "";
            const fp3TrackSlug = parseStreamTrackSlugFromSrc(intentSrc);
            const fp3AlbumSlug = parseStreamSlugFromSrc(intentSrc);
            const fp3TrackMatch = fp1TrackSlug ? fp3TrackSlug === fp1TrackSlug : true;
            // fp3AlbumSlug is null when intentSrc is a bare CDN URL (no ?slug= param),
            // which means the intent prewarm was loaded for a different delivery path.
            // An unknown album slug must reject, not accept, to prevent serving wrong-track audio.
            const fp3AlbumMatch = fp3AlbumSlug ? fp3AlbumSlug === streamSlug : false;
            if (
              intentCdnUrl &&
              intentEl.readyState >= 2 &&
              !isLibraryStreamSrc(intentCdnUrl) &&
              fp3TrackMatch &&
              fp3AlbumMatch
            ) {
              syncSrc = intentCdnUrl;
              backgroundStreamResolve = false;
            }
          }
        } else {
          // Fast-path: scheduleNextTrackPreload already fetched and cached the
          // signed URL from onPlay. Reusing the same URL means waitAudioSrcReady
          // gets an instant HTTP cache hit from the preload element's buffering,
          // and canplaythrough fires in < 100ms instead of after a full network fetch.
          const preloadTrackSlug = parseStreamTrackSlugFromSrc(nextTrack.src) || nextTrack.metadata?.trackSlug || null;
          const preloadCacheKey = preloadTrackSlug ? `${streamSlug}:${preloadTrackSlug}` : streamSlug;
          const preloadCached = nextTrackSignedUrlCacheRef.current[preloadCacheKey];
          if (preloadCached?.url && !streamUrlNeedsRefresh(preloadCached)) {
            syncSrc = preloadCached.url;
            backgroundStreamResolve = false;
          } else {
            try {
              const resolved = await resolveLibraryStreamForTrack(nextTrack, {
                force: options.forceStream,
                signal: streamAbortController.signal,
              });
              const signedUrl = resolved?.track?.src;
              if (signedUrl) {
                syncSrc = signedUrl;
                backgroundStreamResolve = false;
              } else if (isLibraryStreamRedirectSrc(nextTrack.src)) {
                syncSrc = nextTrack.src;
                backgroundStreamResolve = true;
              }
            } catch (err) {
              if (requestId !== playRequestIdRef.current) return false;
              if (err?.name === "AbortError") return false;
              if (isLibraryStreamRedirectSrc(nextTrack.src)) {
                syncSrc = nextTrack.src;
                backgroundStreamResolve = true;
              } else {
                applyStreamResolveError(err);
                return false;
              }
            }
          }
        }
      } else if (redirectFastPath) {
        syncSrc = nextTrack.src;
      }
    }

    const swapToSignedStream = async (resolved) => {
      if (requestId !== playRequestIdRef.current) return;
      if (crossfadeStateRef.current !== "idle") cancelCrossfade();
      const signedUrl = resolved.track?.src;
      if (!signedUrl || signedUrl === syncSrc) return;
      const resumeAt = audio.currentTime || 0;
      const wasPlaying = stateRef.current.isPlaying && !audio.paused;
      skipPauseInterruptionRef.current = true;
      if (isPlaybackTraceEnabled()) {
        logStreamLifecycle("signed-swap-start", {
          source: "swapToSignedStream",
          slug: streamSlug,
          resumeAt,
          wasPlaying,
        });
      }
      const preloadEl = streamSwapPreloadRef.current;
      if (preloadEl) {
        await warmupSignedStreamPreload(preloadEl, signedUrl, {
          signal: streamAbortController.signal,
        });
      }
      if (wasPlaying) {
        patchTransport({ isBuffering: true });
      } else {
        patchTransport({ playbackNetworkState: "loading_stream" });
      }
      await waitAudioSrcReady(audio, signedUrl, { signal: streamAbortController.signal, timeoutMs: 12000 });
      let applySwapSeekTimeout = null;
      const applySwapSeek = () => {
        clearTimeout(applySwapSeekTimeout);
        if (resumeAt > 0 && isFinite(audio.duration)) {
          audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
        }
      };
      if (isFinite(audio.duration) && audio.duration > 0) {
        applySwapSeek();
      } else {
        audio.addEventListener("loadedmetadata", applySwapSeek, { once: true });
        applySwapSeekTimeout = setTimeout(
          () => audio.removeEventListener("loadedmetadata", applySwapSeek),
          5000
        );
      }
      if (wasPlaying && audio.paused && !pausedDuringCurrentLoadRef.current) {
        await playAudioIfNotPaused(audio, true, {
          command: PLAYBACK_COMMANDS.PLAY_TRACK,
          requestId,
          state: stateRef.current,
          context: { source: "signed_stream_swap" },
        });
      }
      const liveTrack = stateRef.current.currentTrack;
      if (!liveTrack || !isSamePlaybackTrack(liveTrack, nextTrack)) return;

      // Cancel any in-flight preview fade ramp before upgrading — a scheduled
      // linearRampToValueAtTime(0) survives the src swap and will silence a
      // fully-entitled user at t=30 unless explicitly cancelled here.
      previewFadeInitRef.current = false;
      const swapGain = userGainRef.current;
      const swapCtx  = audioCtxRef.current;
      if (swapGain && swapCtx) {
        const swapNow = swapCtx.currentTime;
        swapGain.gain.cancelScheduledValues(swapNow);
        swapGain.gain.setValueAtTime(self._deps.userVolumeRef.current, swapNow);
      }

      // Propagate access upgrade into React state so the UI (scrubber cap,
      // preview badge, onTime guard) reflects the full-stream entitlement.
      const upgradedTrack = {
        ...liveTrack,
        src: signedUrl,
        metadata: {
          ...(liveTrack.metadata || {}),
          access: {
            ...(liveTrack.metadata?.access || {}),
            previewOnly: false,
            canStream: true,
          },
        },
      };
      patchState({
        currentTrack: upgradedTrack,
        playbackNetworkState: wasPlaying && !audio.paused ? "playing" : "idle",
        isBuffering: false,
      });
      notifyMediaEngineBridge();
      if (isPlaybackTraceEnabled()) {
        logStreamLifecycle("signed-swap-end", {
          source: "swapToSignedStream",
          slug: streamSlug,
          paused: audio.paused,
        });
      }
    };

    if (backgroundStreamResolve && streamSlug && !redirectFastPath) {
      void resolveLibraryStreamForTrack(nextTrack, {
        force: options.forceStream,
        signal: streamAbortController.signal,
      })
        .then(async (resolved) => {
          const signedUrl = resolved?.track?.src;
          if (signedUrl && signedUrl !== syncSrc && streamSwapPreloadRef.current) {
            await warmupSignedStreamPreload(streamSwapPreloadRef.current, signedUrl, {
              signal: streamAbortController.signal,
            });
          }
          return swapToSignedStream(resolved);
        })
        .catch(redirectFastPath
          ? (err) => {
              if (err?.name !== "AbortError") {
                console.warn("[2MRRW] background stream resolve failed on redirect path", {
                  slug: streamSlug,
                  message: err?.message,
                });
              }
            }
          : applyStreamResolveError);
    }

    const userId = listeningUserIdRef.current;
    const previousLastPlayedSlug = lastPlayedSlugRef.current;
    const playedDifferentSince =
      previousLastPlayedSlug != null && previousLastPlayedSlug !== nextTrack.slug;
    if (playedDifferentSince && userId) {
      clearPlaybackPosition(userId, previousLastPlayedSlug);
    }
    lastPlayedSlugRef.current = nextTrack.slug;

    // resumeAt === 0 signals an explicit "start from beginning" intent (e.g. user taps a
    // catalog card). It suppresses BOTH the localStorage and server-side position restores
    // so saved progress can never silently resume a track mid-way on an intentional play.
    const forceFromBeginning = options.resumeAt === 0;
    let resumeAt =
      options.resumeAt != null && options.resumeAt > RESTORE_MIN_POSITION_SEC
        ? options.resumeAt
        : null;
    if (forceFromBeginning) {
      resumeAt = null;
      if (userId && streamSlug) clearPlaybackPosition(userId, streamSlug);
    }
    if (playedDifferentSince && userId && streamSlug) {
      clearPlaybackPosition(userId, streamSlug);
    }
    if (!resumeAt && !forceFromBeginning && !playedDifferentSince && userId && streamSlug) {
      const saved = getSavedPlaybackPosition(userId, streamSlug);
      if (saved?.positionSeconds > RESTORE_MIN_POSITION_SEC) {
        const clamped = clampRestorePosition(saved.positionSeconds, saved.durationSeconds);
        if (clamped != null) {
          resumeAt = clamped;
        } else {
          clearPlaybackPosition(userId, streamSlug);
        }
      }
    }
    if (!resumeAt && !forceFromBeginning && !playedDifferentSince && !authLoadingRef.current && entitlementAccountStateRef.current?.mediaProgress?.length) {
      const savedProgress = entitlementAccountStateRef.current.mediaProgress.find(
        (p) => p.slug === nextTrack.slug && !p.completed
      );
      if (savedProgress?.positionSeconds > RESTORE_MIN_POSITION_SEC) {
        const clamped = clampRestorePosition(
          savedProgress.positionSeconds,
          savedProgress.durationSeconds
        );
        if (clamped != null) resumeAt = clamped;
      }
    }
    if (resumeAt != null && isFinite(audio.duration) && audio.duration > 0) {
      resumeAt = clampRestorePosition(resumeAt, audio.duration);
    }

    const prevTrack = stateRef.current.currentTrack;
    const sameIdentity = isSamePlaybackTrack(prevTrack, nextTrack);
    const isSameTrack = sameIdentity;
    const isReplay = isSameTrack && audio.ended;
    const previousTrack = stateRef.current.currentTrack;

    if (!sameIdentity) {
      clearContinuityFreeze("playTrackInternal");
    }

    if (isReplay) {
      audio.currentTime = 0;
      pendingSeekRef.current = null;
      patchState({ playbackState: null });
      syncProgressTime(0);
    }

    if (
      previousTrack &&
      !isSamePlaybackTrack(previousTrack, nextTrack) &&
      stateRef.current.hasStarted &&
      !isSameTrack
    ) {
      const prevMeta = streamMetaRef.current;
      if (prevMeta) {
        finalizeStreamSession(prevMeta, {
          completed: false,
          durationSeconds: audio.currentTime || 0,
        });
      }
      recordLocalListening(previousTrack, {
        positionSeconds: audio.currentTime || 0,
        durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
        completed: true,
      });
      self._deps.listeningProgressRef.current = { slug: null, recorded30s: false };
    }

    // Show spinner immediately on new-track load — user tapped Play and expects feedback.
    // onWaiting has a 500ms delay before setting isBuffering; this closes that gap.
    patchTransport({ playbackNetworkState: "loading_stream", isBuffering: true });
    if (isUiHydrationTraceEnabled()) {
      logUiHydrationTrace("PLAYBACK_FIRST_MUTATION", {
        slug: nextTrack.slug ?? null,
        trackId: nextTrack.id ?? null,
        source: "playTrackInternal",
        phase: "p12-track-load",
      });
    }
    patchState({
      currentTrackId: nextTrack.id,
      currentTrack: { ...nextTrack, src: syncSrc },
      source: nextTrack.source,
      error: null,
      accessDenied: false,
      streamRetryable: false,
      streamConflict: null,
      hasStarted: isSameTrack ? stateRef.current.hasStarted : false,
      csTrack: csModeRef.current ? normalized : null,
      playbackState: isSameTrack ? stateRef.current.playbackState : "loading",
    });

    preloadCsAssets(normalized, { csImgRef, csVidRef, csAudioRef });

    try {
      if (isPlaybackTraceEnabled()) {
        logPlaybackEvent({
          type: "play-chain:track-start",
          source: "playTrackInternal",
          extra: {
            requestId,
            slug: nextTrack.slug,
            isSameTrack,
            isReplay,
            syncSrc: syncSrc ? syncSrc.slice(0, 80) : null,
            prevSlug: prevTrack?.slug ?? null,
            resumeAt,
            ctxState: audioCtxRef.current?.state ?? "none",
            audioReadyState: audio.readyState,
            audioPaused: audio.paused,
            audioCurrentTime: audio.currentTime,
          },
        });
      }
      if (!isSameTrack) {
        // Only set the skip flag and pause if not already paused (e.g. from early fast-path
        // src assignment). audio.pause() on an already-paused element is a no-op and won't
        // fire onPause, so the flag would leak into the playing phase and mask real OS pauses.
        if (!audio.paused) {
          skipPauseInterruptionRef.current = true;
          audio.pause();
        }
        // Reset any preview fade that was scheduled and restore userGain to full user volume.
        // audio.volume is permanently locked at 1.0 — volume control lives in userGainRef.
        previewFadeInitRef.current = false;
        const ugain = userGainRef.current;
        const uctx = audioCtxRef.current;
        if (ugain && uctx) {
          const now = uctx.currentTime;
          ugain.gain.cancelScheduledValues(now);
          ugain.gain.setValueAtTime(self._deps.userVolumeRef.current, now);
        }
        spuriousEndedGuardRef.current = Date.now() + SPURIOUS_ENDED_GUARD_MS;

        // HLS adaptive bitrate path — entitled users (canStream) get AES-128 encrypted
        // fMP4 segments over hls.js when a pre-transcoded manifest is available.
        // Falls back transparently to progressive download on 404 (not yet transcoded).
        // Preview users and non-stream paths always use progressive download.
        const isEntitledForHLS = Boolean(nextTrack.metadata?.access?.canStream) && usesLibraryStream && streamSlug;
        if (isPlaybackTraceEnabled()) {
          logPlaybackEvent({
            type: "play-chain:hls-decision",
            source: "playTrackInternal",
            extra: {
              requestId, slug: streamSlug,
              isEntitledForHLS, usesLibraryStream,
              canStream: Boolean(nextTrack.metadata?.access?.canStream),
              ctxState: audioCtxRef.current?.state ?? "none",
              audioSrc: audio.src ? audio.src.slice(0, 80) : null,
              readyState: audio.readyState,
            },
          });
        }
        let hlsDidLoad = false;
        if (isEntitledForHLS && !streamAbortController.signal.aborted) {
          const hlsTrackSlugRaw = nextTrack.metadata?.trackSlug || parseStreamTrackSlugFromSrc(nextTrack.src) || null;
          // For singles, trackSlug equals the product slug — no real sub-track identifier.
          // Normalize to null so the HLS manifest query matches track_slug IS NULL in the DB.
          const hlsTrackSlug = (hlsTrackSlugRaw && hlsTrackSlugRaw !== streamSlug) ? hlsTrackSlugRaw : null;
          const hlsParams = new URLSearchParams({ slug: streamSlug });
          if (hlsTrackSlug) hlsParams.set("trackSlug", hlsTrackSlug);
          const hlsManifestUrl = `/api/library/hls?${hlsParams}`;

          const hlsEngine = getHLSEngine();
          hlsEngine.detach();

          const qualityLevel = await getHLSQualityLevel();
          if (qualityLevel >= 0) hlsEngine.setQualityLevel(qualityLevel);

          hlsDidLoad = await new Promise((resolve) => {
            let settled = false;
            const done = (loaded) => {
              if (settled) return;
              settled = true;
              resolve(loaded);
            };
            hlsEngine.onFallback = () => done(false); // 404 — not yet transcoded
            hlsEngine.onError    = () => done(false); // fatal error — fall back
            hlsEngine.onSegmentFatalError = () => {
              // Segments failed after manifest loaded (CORS, CDN, iOS network error).
              // Detach HLS and fall back to progressive download mid-stream.
              reportPlaybackDiagnostic({
                level: "warn",
                code: "HLS_SEGMENT_FATAL_FALLBACK",
                command: PLAYBACK_COMMANDS.PLAY_TRACK,
                requestId,
                state: stateRef.current,
                context: { slug: streamSlug },
              });
              hlsEngineRef.current = null;
              if (isPlaybackTraceEnabled()) {
                logPlaybackEvent({
                  type: "play-chain:hls-segment-fatal-fallback",
                  source: "playTrackInternal",
                  extra: { requestId, slug: streamSlug },
                });
              }
              const fallbackMs = isLibraryStreamRedirectSrc(syncSrc) ? 12000 : AUDIO_SRC_READY_TIMEOUT_MS;
              waitAudioSrcReady(audio, syncSrc, { signal: streamAbortController.signal, timeoutMs: fallbackMs })
                .catch(() => {});
            };

            hlsEngine.loadTrack(hlsManifestUrl, audio, {
              startPosition: resumeAt || 0,
            }).then((loaded) => done(loaded)).catch(() => done(false));

            // Respect abort signal — don't block if a newer play request arrived
            streamAbortController.signal.addEventListener("abort", () => done(false), { once: true });
          });

          hlsEngineRef.current = hlsDidLoad ? hlsEngine : null;
          if (isPlaybackTraceEnabled()) {
            logPlaybackEvent({
              type: "play-chain:hls-result",
              source: "playTrackInternal",
              extra: {
                requestId, slug: streamSlug, hlsDidLoad,
                readyState: audio.readyState,
                bufferedEnd: audio.buffered?.length ? audio.buffered.end(audio.buffered.length - 1).toFixed(2) : "0",
              },
            });
          }
        } else {
          // No HLS for this track — detach any lingering engine from the previous track
          if (hlsEngineRef.current) {
            hlsEngineRef.current.detach();
            hlsEngineRef.current = null;
          }
        }

        // Progressive download fallback (non-HLS path or HLS manifest 404)
        // Redirect-path sources (/api/library/stream?redirect=1) with DIRECT_STREAM_REDIRECT_ENABLED
        // go straight from Cloudflare edge to the browser — no Vercel proxy hop. 12s gives
        // headroom for initial auth + signed URL resolution without stranding a paying user.
        if (!hlsDidLoad) {
          const srcReadyTimeout = isLibraryStreamRedirectSrc(syncSrc) ? 12000 : AUDIO_SRC_READY_TIMEOUT_MS;
          await waitAudioSrcReady(audio, syncSrc, { signal: streamAbortController.signal, timeoutMs: srcReadyTimeout });
        }
        // Industry-level buffer gate: require readyState >= 4 (HAVE_ENOUGH_DATA) AND
        // at least 5 s buffered ahead of currentTime before starting playback.
        //
        // Why both conditions together:
        //   • readyState 4 alone fires optimistically when signed URLs share HTTP cache
        //     with the preload element — real decode buffer can still be < 1 s, causing
        //     the audible "plays → silence → continues" pattern at 2–3 s in.
        //   • 5 s ahead covers one full HLS segment (6 s) and gives the decoder enough
        //     runway to absorb mobile bandwidth variance without stalling.
        //   • 8 s timeout cap: if network hasn't buffered 5 s in 8 s we start anyway
        //     (graceful degradation beats infinite spinner). The cap will NOT fire if the
        //     browser has literally no data yet (readyState 0) — it extends up to 12 s
        //     in that case to avoid starting into guaranteed silence.
        //   • Cache-warm preloaded streams pass both conditions in < 5 ms.
        // During a crossfade bridge the preload element is already audible, so the
        // buffer gate serves no purpose — it only lets the preload element's position
        // drift away from the main element's start position. Skip it; position is snapped.
        if (!isSameTrack && !streamAbortController.signal.aborted && crossfadeStateRef.current !== "bridging") {
          // Buffer gate: do not call play() until 3 s of decoded audio is ahead
          // of currentTime at readyState >= 3 (HAVE_FUTURE_DATA). 3 s covers half
          // an HLS segment (segments are ~6 s) — the decoder has a full segment's
          // runway before needing the next one, eliminating the play→stall→resume
          // double-play pattern caused by starting with only a partial segment
          // in the buffer. On typical connections this gate clears in < 500 ms.
          // readyState >= 4 + 5 s caused 5+ second start delays — not used.
          const MIN_BUF = 3;
          const goodBuffer = () => {
            try {
              const buf = audio.buffered;
              const t = audio.currentTime;
              for (let i = 0; i < buf.length; i++) {
                if (buf.start(i) <= t + 0.5 && buf.end(i) - t >= MIN_BUF) return true;
              }
            } catch {}
            return false;
          };
          const isReady = () => audio.readyState >= 3 && goodBuffer();
          if (!isReady()) {
            await new Promise((resolve) => {
              if (isReady() || streamAbortController.signal.aborted) { resolve(); return; }
              let pollId = null;
              const done = () => {
                audio.removeEventListener("canplay", onCanPlay);
                audio.removeEventListener("progress", onProgress);
                clearInterval(pollId);
                clearTimeout(capId);
                resolve();
              };
              // canplay fires at readyState >= 3 — enough data to start without stalling.
              // progress fires as bytes arrive on slower connections.
              // 100 ms poll guards against Safari/Edge suppressing events.
              const onCanPlay = () => { if (isReady()) done(); };
              const onProgress = () => { if (isReady()) done(); };
              pollId = setInterval(() => { if (isReady() || streamAbortController.signal.aborted) done(); }, 100);
              // 4 s primary cap. On HAVE_NOTHING (zero bytes after 4 s), extend 2 s
              // before giving up — covers genuinely slow or cold CDN connections.
              const capId = setTimeout(() => {
                if (audio.readyState === 0 && !streamAbortController.signal.aborted) {
                  const extId = setTimeout(done, 2000);
                  streamAbortController.signal.addEventListener("abort", () => { clearTimeout(extId); done(); }, { once: true });
                } else {
                  done();
                }
              }, 4000);
              audio.addEventListener("canplay", onCanPlay, { once: true });
              audio.addEventListener("progress", onProgress);
              streamAbortController.signal.addEventListener("abort", done, { once: true });
            });
          }
        }
        // HLS stall fallback: manifest loaded but segments never arrived (CORS error, CDN failure,
        // or ManagedMediaSource init race on iOS). readyState 0 = browser received zero bytes.
        // Fall back to progressive download so iOS users get audio instead of silence.
        if (hlsDidLoad && !streamAbortController.signal.aborted && audio.readyState < 2) {
          const hlsEng = hlsEngineRef.current;
          if (hlsEng) { hlsEng.detach(); hlsEngineRef.current = null; }
          reportPlaybackDiagnostic({
            level: "warn",
            code: "HLS_SEGMENT_STALL_FALLBACK",
            command: PLAYBACK_COMMANDS.PLAY_TRACK,
            requestId,
            state: stateRef.current,
            context: { readyState: audio.readyState, slug: streamSlug },
          });
          if (isPlaybackTraceEnabled()) {
            logPlaybackEvent({
              type: "play-chain:hls-stall-fallback",
              source: "playTrackInternal",
              extra: { requestId, slug: streamSlug, readyState: audio.readyState },
            });
          }
          const fallbackTimeoutMs = isLibraryStreamRedirectSrc(syncSrc) ? 12000 : AUDIO_SRC_READY_TIMEOUT_MS;
          await waitAudioSrcReady(audio, syncSrc, { signal: streamAbortController.signal, timeoutMs: fallbackTimeoutMs });
        }

        if (isPlaybackTraceEnabled()) {
          logPlaybackEvent({
            type: "play-chain:buffer-gate-done",
            source: "playTrackInternal",
            extra: {
              requestId, slug: streamSlug,
              readyState: audio.readyState,
              bufferedEnd: audio.buffered?.length ? audio.buffered.end(audio.buffered.length - 1).toFixed(2) : "0",
              currentTime: audio.currentTime,
              hlsDidLoad,
              signalAborted: streamAbortController.signal.aborted,
            },
          });
        }

        // If a newer play request arrived while we were waiting (canplaythrough or buffer guard),
        // bail out cleanly — do NOT set error state, this track was intentionally superseded.
        // Always restore gain before returning so mainGainRef never stays at 0.
        if (requestId !== playRequestIdRef.current || streamAbortController.signal.aborted) {
          cancelCrossfade();
          return false;
        }
        // Crossfade bridging: snap main element to preload element's current position
        // so the 0.35s gain handoff crosses two streams at the same playhead. Without
        // this, the main element starts at cfResumeAt while the preload element has
        // drifted forward by the HLS manifest negotiation time, producing an audible
        // position jump when mainGain ramps up and cfGain ramps down simultaneously.
        if (crossfadeStateRef.current === "bridging") {
          const preloadEl = nextTrackPreloadRef.current;
          if (preloadEl && isFinite(preloadEl.currentTime) && preloadEl.currentTime > 0.05) {
            try { audio.currentTime = preloadEl.currentTime; } catch {}
          }
        }
        patchState({ hasStarted: true, playbackState: "ready" });
        const startedPlay = await playAudioIfNotPaused(audio, !pausedDuringCurrentLoadRef.current, {
          command: PLAYBACK_COMMANDS.PLAY_TRACK,
          requestId,
          state: stateRef.current,
          context: { source: nextTrack.source },
          signal: streamAbortController.signal,
        });
        if (!startedPlay) {
          patchState({
            isPlaying: false,
            isBuffering: false,
            error: "Audio playback failed. Try again in a moment.",
            playbackState: "paused",
            playbackNetworkState: "error_stream",
          });
          void updateMediaSession({ ...nextTrack, src: syncSrc }, { playing: false });
          return false;
        }
        // Main element is now playing. If we were in crossfade bridge mode (mainGain=0,
        // cfGain=1, preload element audible), schedule a 350ms ramp to hand off audio
        // from the preload element to the main element. Without this, mainGain stays at 0
        // forever and all subsequent playback (including user taps) is silent.
        if (crossfadeStateRef.current === "bridging") {
          const nextGainLinear = Math.pow(10, (nextTrack.gainDb || 0) / 20);
          scheduleCrossfadeHandoff(nextGainLinear);
        }
        // Entitled users (canStream) start on the full library stream directly — they never
        // enter the preview path. Non-entitled users who gain access mid-session are upgraded
        // via upgradeToFullStream dispatched from the onEntitlementsUpdated handler, not by
        // racing a prefetch here. No preview-first path for any entitled tier.
        if (process.env.NODE_ENV !== "production" && nextTrack.metadata?.access?.canStream && syncSrc === previewSrc) {
          console.error("[AudioContext] BUG: entitled user started on preview src — check toInstantStartTrack and justGainedStream", { slug: nextTrack.slug });
        }
        pendingSeekRef.current = resumeAt;
      } else {
        if (!audio.paused) {
          const audible = isAudioActuallyAudible({
            audio,
            webAudioContext: audioCtxRef.current,
            sampleRef: audibilitySampleRef,
          });
          patchState({
            hasStarted: true,
            playbackState: audible ? "playing" : "ready",
            isPlaying: audible,
            error: null,
          });
          applyCsToElement(audio, presentation, pendingSeekRef.current || null);
          return audible;
        }
        if (resumeAt) {
          const dur = isFinite(audio.duration) ? audio.duration : 0;
          const safe = dur > 0 ? clampRestorePosition(resumeAt, dur) : resumeAt;
          if (safe != null && Math.abs(audio.currentTime - safe) > 2) {
            audio.currentTime = safe;
          } else if (safe == null && userId && streamSlug) {
            clearPlaybackPosition(userId, streamSlug);
          }
        }
      }

      applyCsToElement(audio, presentation, pendingSeekRef.current || null);
      if (requestId !== playRequestIdRef.current) return false;

      if (pendingSeekRef.current) {
        const pendingSnapshot = pendingSeekRef.current;
        const applyPendingSeek = () => {
          clearTimeout(pendingSeekTimeoutRef);
          if (pendingSnapshot != null && isFinite(audio.duration) && audio.duration > 0) {
            const safe = clampRestorePosition(pendingSnapshot, audio.duration);
            if (safe != null) {
              audio.currentTime = safe;
            } else if (listeningUserIdRef.current && nextTrack.slug) {
              clearPlaybackPosition(listeningUserIdRef.current, nextTrack.slug);
            }
            spuriousEndedGuardRef.current = Date.now() + SPURIOUS_ENDED_GUARD_MS;
          }
          pendingSeekRef.current = null;
        };
        audio.addEventListener("loadedmetadata", applyPendingSeek, { once: true });
        const pendingSeekTimeoutRef = setTimeout(
          () => audio.removeEventListener("loadedmetadata", applyPendingSeek),
          5000
        );
      }

      // Same-track resume: restore userGain if a preview fade left it faded to 0.
      // New-track path already reset gain before waitAudioSrcReady.
      if (isSameTrack) {
        previewFadeInitRef.current = false;
        const resGain = userGainRef.current;
        const resCtx = audioCtxRef.current;
        if (resGain && resCtx) {
          const now = resCtx.currentTime;
          resGain.gain.cancelScheduledValues(now);
          resGain.gain.setValueAtTime(self._deps.userVolumeRef.current, now);
        }
      }

      if (isSameTrack) {
        const played = await playAudioIfNotPaused(audio, true, {
          command: PLAYBACK_COMMANDS.PLAY_TRACK,
          requestId,
          state: stateRef.current,
          context: { source: nextTrack.source, sameTrack: true },
          signal: streamAbortController.signal,
        });
        if (!played) {
          patchState({
            isPlaying: false,
            error: "Audio playback failed. Try again in a moment.",
            playbackState: "paused",
            playbackNetworkState: "error_stream",
          });
          void updateMediaSession({ ...nextTrack, src: syncSrc }, { playing: false });
          return false;
        }
      }
      void updateMediaSession({ ...nextTrack, src: syncSrc }, { playing: !audio.paused });

      if (isReplay) {
        sendControlSystemPlaybackEvent(nextTrack, "replay", {
          mediaType: "audio",
          positionSeconds: 0,
          durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
        });
      }
      patchState({
        error: null,
        hasStarted: true,
        playbackState: audio.paused ? "paused" : "ready",
      });
      return !audio.paused;
    } catch (err) {
      // Superseded by a newer navigation command — the stream abort is intentional,
      // not an error. Exit silently so the new command can start without any error state.
      if (err?.code === "AUDIO_SRC_ABORTED") {
        if (crossfadeStateRef.current !== "idle") cancelCrossfade();
        patchTransport({ isBuffering: false, playbackNetworkState: "idle" });
        return false;
      }
      const previewFallbackSrc =
        getTrackPreviewSrc(nextTrack) ||
        nextTrack?.metadata?.previewSrc ||
        nextTrack?.preview ||
        null;
      const failedLibraryStream =
        isLibraryStreamSrc(syncSrc) || isLibraryStreamSrc(nextTrack?.src || "");
      if (failedLibraryStream && previewFallbackSrc && !isAdminAccount(entitlementAccountStateRef.current)) {
        console.warn("[AudioContext] library stream load failed; falling back to preview", {
          slug: nextTrack?.slug,
          message: err?.message || String(err),
        });
        logStreamLifecycle("preview-fallback", {
          source: "playTrackInternal",
          slug: nextTrack?.slug,
        });
        try {
          skipPauseInterruptionRef.current = true;
          const played = await loadAudioSrcAndPlay(audio, previewFallbackSrc, {
            signal: streamAbortController.signal,
          });
          patchState({
            isPlaying: false,
            error: played ? null : "Preview unavailable",
            source: "preview",
            playbackState: played ? "preview_fallback" : "idle",
            playbackNetworkState: played ? "playing" : "error_stream",
            hasStarted: played,
            currentTrack: {
              ...nextTrack,
              src: previewFallbackSrc,
              metadata: {
                ...(nextTrack.metadata || {}),
                access: {
                  ...(nextTrack.metadata?.access || {}),
                  previewOnly: true,
                  canStream: false,
                },
              },
            },
          });
          return played;
        } catch (previewErr) {
          // Both primary stream and preview failed. cancelCrossfade restores mainGain from
          // any stuck "bridging" state — without this, the next track starts silently.
          cancelCrossfade();
          console.error("[AudioContext] preview fallback failed", {
            slug: nextTrack?.slug,
            message: previewErr?.message || String(previewErr),
          });
          if (nextTrack?.slug) {
            writeAvailabilityCache(
              {
                slug: nextTrack.slug,
                trackSlug: nextTrack.metadata?.trackSlug,
                albumSlug: nextTrack.metadata?.albumSlug,
              },
              { status: "unavailable", reasons: ["missing_preview"], audioKey: null, previewKey: null }
            );
          }
          patchState({
            isPlaying: false,
            isBuffering: false,
            error: "Preview unavailable",
            streamRetryable: false,
            hasStarted: false,
            playbackState: "idle",
            playbackNetworkState: "error_stream",
          });
          void updateMediaSession(nextTrack, { playing: false });
          return false;
        }
      }
      // Always cancel crossfade on failure — if we were in "bridging" state,
      // mainGainRef.gain was set to 0 to hide the gap; leaving it there makes
      // subsequent tracks inaudible until the user seeks or seeks manually.
      cancelCrossfade();
      console.error("[AudioContext] playTrack failed", {
        message: err?.message || String(err),
        code: err?.code || null,
        slug: nextTrack?.slug || null,
      });
      patchState({
        isPlaying: false,
        isBuffering: false,
        error: "Audio playback failed. Try again in a moment.",
        playbackState: "paused",
        playbackNetworkState: "error_stream",
      });
      void updateMediaSession(nextTrack, { playing: false });
      return false;
    }
  };

  self.upgradeToFullStream = async function upgradeToFullStream() {
    const {
      patchState, resolveLibraryStreamForTrack, logDirectInternalCallViolation, tracePlayback,
      stateRef, audioRef, streamMetaRef, activeStreamAbortRef, entitlementAccountStateRef,
      listeningUserIdRef, streamSwapPreloadRef, skipPauseInterruptionRef,
    } = self._deps;

    logDirectInternalCallViolation("upgradeToFullStream");
    tracePlayback("upgradeToFullStream", "upgradeToFullStream", {
      slug: stateRef.current.currentTrack?.slug ?? null,
    });
    logStateChurn("upgradeToFullStream", {
      source: "AudioContext",
      reason: "invoke",
      slug: stateRef.current.currentTrack?.slug ?? null,
    });
    const audio = audioRef.current;
    const track = stateRef.current.currentTrack;
    if (!audio || !track?.slug) return false;
    const serverUserId = entitlementAccountStateRef.current?.user?.id;
    const clientUserId = listeningUserIdRef.current;
    if (!serverUserId || !clientUserId || serverUserId !== clientUserId) {
      return false;
    }
    const previewSrc = getTrackPreviewSrc(track);
    const currentPlaybackSrc = normalizePlaybackSrc(audio.currentSrc || audio.src || "");
    const signedUrl = streamMetaRef.current?.url
      ? normalizePlaybackSrc(streamMetaRef.current.url)
      : "";
    const stillOnPreview =
      Boolean(previewSrc) &&
      (currentPlaybackSrc === normalizePlaybackSrc(previewSrc) ||
        (Boolean(track.metadata?.access?.previewOnly) &&
          !isLibraryStreamSrc(currentPlaybackSrc) &&
          !signedUrl));

    if (!track.metadata?.access?.previewOnly && signedUrl && currentPlaybackSrc === signedUrl) {
      return true;
    }
    if (!stillOnPreview && signedUrl && currentPlaybackSrc === signedUrl) {
      return true;
    }
    if (!stillOnPreview && !track.metadata?.access?.previewOnly && isLibraryStreamSrc(currentPlaybackSrc)) {
      return true;
    }

    const rawUpgradeTrackSlug = track.metadata?.trackSlug || track.trackSlug || null;
    // Only add trackSlug when it actually identifies a sub-track inside a different album.
    // For singles, trackSlug === slug — adding it creates a wrong cache key on the server.
    const upgradeTrackSlug = rawUpgradeTrackSlug && rawUpgradeTrackSlug !== track.slug ? rawUpgradeTrackSlug : null;
    const upgradeParams = new URLSearchParams({ slug: track.slug, redirect: "1" });
    if (upgradeTrackSlug) upgradeParams.set("trackSlug", upgradeTrackSlug);
    const libraryTrack = {
      ...track,
      src: `/api/library/stream?${upgradeParams.toString()}`,
    };

    patchState({ playbackNetworkState: "loading_stream" });
    try {
      const cachedMeta = streamMetaRef.current;
      const useCachedUrl = cachedMeta?.slug === track.slug && cachedMeta?.url && !streamUrlNeedsRefresh(cachedMeta);
      const resolved = useCachedUrl
        ? { track: { ...libraryTrack, src: cachedMeta.url }, meta: cachedMeta }
        : await resolveLibraryStreamForTrack(libraryTrack, { force: false, signal: activeStreamAbortRef.current?.signal });
      const nextSrc = normalizePlaybackSrc(resolved.track.src);
      if (nextSrc && nextSrc === currentPlaybackSrc) {
        patchState({
          currentTrack: {
            ...track,
            src: resolved.track.src,
            metadata: {
              ...track.metadata,
              access: {
                ...(track.metadata?.access || {}),
                previewOnly: false,
                canStream: true,
              },
            },
          },
          playbackState: audio.paused ? "paused" : "playing",
          error: null,
          accessDenied: false,
        });
        return true;
      }
      const preloadEl = streamSwapPreloadRef.current;
      if (preloadEl) {
        await warmupSignedStreamPreload(preloadEl, resolved.track.src, { timeoutMs: 2500 });
      }
      const resumeAt = audio.currentTime || 0;
      skipPauseInterruptionRef.current = true;
      patchState({ playbackNetworkState: "loading_stream" });
      await waitAudioSrcReady(audio, resolved.track.src, { signal: activeStreamAbortRef.current?.signal });
      if (resumeAt > 0) {
        const applyUpgradeSeek = () => {
          if (isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
          }
        };
        if (isFinite(audio.duration) && audio.duration > 0) {
          applyUpgradeSeek();
        } else {
          let upgradeSeekCleanup;
          const onUpgradeMetadata = () => {
            clearTimeout(upgradeSeekCleanup);
            applyUpgradeSeek();
          };
          audio.addEventListener("loadedmetadata", onUpgradeMetadata, { once: true });
          upgradeSeekCleanup = setTimeout(
            () => audio.removeEventListener("loadedmetadata", onUpgradeMetadata),
            5000
          );
        }
      }
      patchState({
        currentTrack: {
          ...track,
          src: resolved.track.src,
          metadata: {
            ...track.metadata,
            access: {
              ...(track.metadata?.access || {}),
              previewOnly: false,
              canStream: true,
            },
          },
        },
        playbackState: audio.paused ? "paused" : "playing",
        playbackNetworkState: audio.paused ? "idle" : "playing",
        error: null,
        accessDenied: false,
      });
      if (!audio.paused) await playAudioIfNotPaused(audio, stateRef.current.isPlaying);
      return true;
    } catch (err) {
      if (err?.name === "AbortError" || err?.code === "AUDIO_SRC_ABORTED") return false;
      if (err?.code === "ACCESS_DENIED") {
        patchState({
          accessDenied: true,
          error: "Access unavailable",
          isPlaying: false,
          playbackNetworkState: "error_stream",
        });
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
      } else {
        patchState({
          isPlaying: false,
          playbackNetworkState: "error_stream",
        });
      }
      return false;
    }
  };

  self.setOnPreviewEnded = function setOnPreviewEnded(handler) {
    self._deps.onPreviewEndedRef.current = typeof handler === "function" ? handler : null;
  };

  self.overrideConcurrentStream = async function overrideConcurrentStream() {
    const { patchState, stateRef, playTrackRef } = self._deps;
    const conflict = stateRef.current.streamConflict;
    if (!conflict?.track) return false;
    patchState({ streamConflict: null });
    return (
      playTrackRef.current?.(conflict.track, {
        resumeAt: conflict.resumeAt,
        forceStream: true,
      }) ?? false
    );
  };

  self.dismissStreamConflict = function dismissStreamConflict() {
    self._deps.patchState({ streamConflict: null });
  };

  self.retryStreamPlayback = async function retryStreamPlayback() {
    const { patchState, stateRef, audioRef, stallHardAttemptRef, streamErrorRetriedRef, playTrackRef } = self._deps;
    const track = stateRef.current.currentTrack;
    if (!track) return false;
    stallHardAttemptRef.current = 0;
    streamErrorRetriedRef.current = 0;
    patchState({ error: null, streamRetryable: false, accessDenied: false });
    const resumeAt = audioRef.current?.currentTime || stateRef.current.currentTime || 0;
    // preserveQueue: true — retry must not replace the album/EP queue; next/prev
    // must still work after the stall recovers.
    return playTrackRef.current?.(track, { resumeAt, forceStream: true, preserveQueue: true }) ?? false;
  };
}
