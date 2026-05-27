"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { resetPlaybackTelemetry, sendControlSystemPlaybackEvent } from "@/lib/control-system/playback";
import { recordListeningEvent } from "@/lib/listening-history";
import {
  clearPlaybackPosition,
  getSavedPlaybackPosition,
  savePlaybackPosition,
} from "@/lib/playback/position-memory";
import {
  clearLibraryStreamSession,
  endStreamAnalytics,
  fetchLibraryStream,
  isLibraryStreamRedirectSrc,
  isLibraryStreamSrc,
  parseStreamSlugFromSrc,
  streamUrlNeedsRefresh,
} from "@/lib/playback/stream-client";
import { catalogPreviewAudioUrl } from "@/lib/media-urls";
import {
  clearPersistedMediaSessionTrack,
  getArtworkEntriesForTrack,
  persistMediaSessionTrack,
  readPersistedMediaSessionTrack,
} from "@/lib/media-session-artwork";
import { resolveCoverMediaType } from "@/components/ui/CoverArt";
import { mapContextTrackToMediaTrack } from "@/media/useMediaEngine";
import {
  notifyMediaEngineBridge,
  registerMediaEngineBridge,
} from "@/media/mediaEngineBridge";
import { preloadCoverImage } from "@/lib/media/preload";
import { logPlayback } from "@/lib/observability/client-log";
import { MARKS, perfMark, perfMeasure } from "@/lib/dev/performanceMarks";
import AudioPhase10Bridge from "@/components/system/AudioPhase10Bridge";
import { isFirstListen, markListened } from "@/lib/first-listen";

const AudioContext = createContext(null);

const REPEAT_MODES = ["off", "all", "one"];
const POSITION_STATE_THROTTLE_MS = 1000;
const SLOWED_SUFFIX = " · Slowed";
const CS_PLAYBACK_RATE = 0.75;
const POSITION_SAVE_INTERVAL_MS = 15000;
const STORE_LINK_HREF = "/subscribe";
const PREVIEW_HARD_CAP_SEC = 30;
const RESTORE_MIN_POSITION_SEC = 5;
const RESTORE_NEAR_END_BUFFER_SEC = 3;
const SPURIOUS_ENDED_GUARD_MS = 1200;
const KEEP_ALIVE_INTERVAL_MS = 20000;
const GESTURE_UNLOCK_EVENTS = ["touchstart", "touchend", "click", "keydown"];

function normalizePlaybackSrc(src) {
  if (!src || typeof src !== "string") return "";
  try {
    return new URL(src, typeof window !== "undefined" ? window.location.href : "http://localhost").href;
  } catch {
    return String(src);
  }
}

function isNearEndRestorePosition(positionSeconds, durationSeconds) {
  if (!Number.isFinite(positionSeconds) || positionSeconds < RESTORE_MIN_POSITION_SEC) return true;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  return positionSeconds >= durationSeconds - RESTORE_NEAR_END_BUFFER_SEC;
}

/** Reject invalid or near-end restores that would immediately fire `ended`. */
function clampRestorePosition(positionSeconds, durationSeconds) {
  if (!Number.isFinite(positionSeconds) || positionSeconds < RESTORE_MIN_POSITION_SEC) return null;
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    if (isNearEndRestorePosition(positionSeconds, durationSeconds)) return null;
    return Math.min(positionSeconds, durationSeconds - RESTORE_NEAR_END_BUFFER_SEC);
  }
  return positionSeconds;
}

/** Set src, wait for canplay/error/timeout, then load(). */
async function waitAudioSrcReady(audio, src) {
  audio.src = src;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      audio.removeEventListener("canplay", finish);
      audio.removeEventListener("canplaythrough", finish);
      audio.removeEventListener("error", finish);
      clearTimeout(fallback);
      resolve();
    };
    const fallback = setTimeout(finish, 3000);
    audio.addEventListener("canplay", finish);
    audio.addEventListener("canplaythrough", finish);
    audio.addEventListener("error", finish);
    audio.load();
  });
}

async function loadAudioSrcAndPlay(audio, src) {
  await waitAudioSrcReady(audio, src);
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[AUDIO]", e.name, e.message);
    }
  }
}

async function playAudioIfNotPaused(audio, isPlaying) {
  if (!isPlaying) return;
  if (!audio.paused) return;
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[AUDIO]", e.name, e.message);
    }
  }
}

/** Safari keeps AudioContext suspended until resumed inside a user gesture. */
async function resumeWebAudioContextIfSuspended(ctxRef) {
  const ctx = ctxRef?.current;
  if (!ctx || ctx.state !== "suspended") return;
  try {
    await ctx.resume();
  } catch (e) {
    console.warn("[WebAudio] resume failed:", e);
  }
}

function getTrackPreviewSrc(track) {
  const previewPath =
    track?.preview ||
    track?.preview_path ||
    track?.previewPath ||
    track?.metadata?.previewPath;
  if (previewPath) return catalogPreviewAudioUrl(previewPath);
  if (track?.src && !isLibraryStreamSrc(track.src)) return track.src;
  return null;
}

function dispatchPreviewEnded(slug) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("preview:ended", { detail: { slug } }));
}

const EMPTY_STATE = {
  currentTrackId: null,
  currentTrack: null,
  source: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  error: null,
  hasStarted: false,
  isBuffering: false,
  accessDenied: false,
  streamRetryable: false,
  streamConflict: null,
  queue: [],
  queueIndex: -1,
  repeatMode: "off",
  shuffle: false,
  csMode: false,
  csTrack: null,
  playbackState: null,
  spaceMode: false,
  bassMode: false,
  atmosphereLevel: 3,
};

function stripSlowedSuffix(title) {
  if (!title) return "Untitled";
  return title.endsWith(SLOWED_SUFFIX) ? title.slice(0, -SLOWED_SUFFIX.length) : title;
}

function withSlowedSuffix(title) {
  const base = stripSlowedSuffix(title);
  return `${base}${SLOWED_SUFFIX}`;
}

const normalizeTrack = (track = {}) => {
  const src = track.src || track.preview || track.audio || track.url || "";
  const id = track.id || track.trackId || track.slug || src;
  const baseTitle = stripSlowedSuffix(track.title || "Untitled");
  const baseCover = track.baseCover || track.cover || track.coverArt || track.image || null;
  const csAudio = track.csAudio || track.cs_audio || null;
  const csCover = track.csCover || track.cs_cover || track.csCoverArt || null;
  const coverArtType = track.coverArtType || track.cover_art_type || (track.video ? "video" : "image");
  const csCoverType = track.csCoverType || track.cs_cover_type || "image";
  return {
    id,
    slug: track.slug || id,
    title: baseTitle,
    artist: track.artist || "2MRRW",
    cover: baseCover,
    baseSrc: track.baseSrc || src,
    baseCover,
    src,
    coverArtType,
    csAudio: csAudio || null,
    csCover: csCover || null,
    csCoverType,
    hasCs: Boolean(csAudio || csCover),
    source: track.source || "unknown",
    metadata: track.metadata || {},
    preview: track.preview || track.preview_path || track.previewPath || null,
    preview_path: track.preview_path || track.previewPath || track.preview || null,
  };
};

function resolvePlaybackPresentation(track, csOn, usingCsSrc) {
  if (!track) return track;
  const baseTitle = stripSlowedSuffix(track.title);
  const baseSrc = track.baseSrc || track.src;
  const baseCover = track.baseCover || track.cover;
  if (!csOn) {
    return {
      ...track,
      title: baseTitle,
      src: baseSrc,
      cover: baseCover,
      playbackRate: 1,
      useCsSrc: false,
    };
  }
  if (track.csAudio) {
    return {
      ...track,
      title: withSlowedSuffix(baseTitle),
      src: track.csAudio,
      cover: track.csCover || baseCover,
      playbackRate: 1,
      useCsSrc: true,
    };
  }
  return {
    ...track,
    title: withSlowedSuffix(baseTitle),
    src: baseSrc,
    cover: baseCover,
    playbackRate: CS_PLAYBACK_RATE,
    useCsSrc: false,
  };
}

function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true
  );
}

function preloadCsAssets(track, refs) {
  refs.csImgRef.current = null;
  refs.csVidRef.current = null;
  refs.csAudioRef.current = null;
  if (!track) return;
  if (track.csCover) {
    const mediaType = resolveCoverMediaType(track.csCover, track.csCoverType);
    if (mediaType === "video") {
      const vid = document.createElement("video");
      vid.preload = "auto";
      vid.src = track.csCover;
      vid.load();
      refs.csVidRef.current = vid;
    } else {
      const img = new Image();
      img.src = track.csCover;
      refs.csImgRef.current = img;
    }
  }
  if (track.csAudio) {
    const preload = new Audio();
    preload.preload = "auto";
    preload.src = track.csAudio;
    preload.load();
    refs.csAudioRef.current = preload;
  }
}

export function AudioProvider({ children }) {
  const { user, accountState } = useAuth();
  const csImgRef = useRef(null);
  const csVidRef = useRef(null);
  const csAudioRef = useRef(null);
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const stereoPannerRef = useRef(null);
  const bassFilterRef = useRef(null);
  const lastPersistRef = useRef({ key: null, at: 0 });
  const pendingSeekRef = useRef(null);
  const stateRef = useRef(EMPTY_STATE);
  const queueRef = useRef([]);
  const queueIndexRef = useRef(-1);
  const repeatModeRef = useRef("off");
  const shuffleRef = useRef(false);
  const csModeRef = useRef(false);
  const csUsingAlternateSrcRef = useRef(false);
  const playTrackRef = useRef(null);
  const applyCSModeToTrackRef = useRef(null);
  const userPausedRef = useRef(false);
  const skipPauseInterruptionRef = useRef(false);
  const lastPositionStateAtRef = useRef(0);
  const progressRafRef = useRef(null);
  const listeningUserIdRef = useRef(null);
  const listeningProgressRef = useRef({ slug: null, recorded30s: false });
  const streamMetaRef = useRef(null);
  const streamErrorRetriedRef = useRef(false);
  const onPreviewEndedRef = useRef(null);
  const [previewEnded, setPreviewEnded] = useState(false);
  const wasPlayingBeforeHideRef = useRef(false);
  const keepAliveIntervalRef = useRef(null);
  const sessionUnlockedRef = useRef(false);
  const webAudioInitializedRef = useRef(false);
  const webAudioAvailableRef = useRef(true);
  const retryStreamPlaybackRef = useRef(null);
  const positionSaveTimerRef = useRef(null);
  const lastPlayedSlugRef = useRef(null);
  const csHoldSavedRef = useRef(null);
  const csHoldActiveRef = useRef(false);
  const spuriousEndedGuardRef = useRef(0);
  const [state, setState] = useState(EMPTY_STATE);

  useEffect(() => {
    listeningUserIdRef.current = user?.id || null;
  }, [user?.id]);

  const stopPositionSaveTimer = useCallback(() => {
    if (positionSaveTimerRef.current) {
      clearInterval(positionSaveTimerRef.current);
      positionSaveTimerRef.current = null;
    }
  }, []);

  const startPositionSaveTimer = useCallback(() => {
    stopPositionSaveTimer();
    positionSaveTimerRef.current = setInterval(() => {
      const audio = audioRef.current;
      const track = stateRef.current.currentTrack;
      const userId = listeningUserIdRef.current;
      if (!audio || !track?.slug || !userId || audio.paused) return;
      const dur = isFinite(audio.duration) ? audio.duration : 0;
      const pos = audio.currentTime || 0;
      if (dur > 0 && isNearEndRestorePosition(pos, dur)) return;
      savePlaybackPosition(userId, track.slug, pos, dur);
    }, POSITION_SAVE_INTERVAL_MS);
  }, [stopPositionSaveTimer]);

  const finalizeStreamSession = useCallback((meta, { completed = false, durationSeconds = 0 } = {}) => {
    if (!meta?.streamEventId && !meta?.sessionId) return;
    void endStreamAnalytics({
      streamEventId: meta.streamEventId || null,
      sessionId: meta.sessionId || null,
      durationSeconds,
      completed,
    });
    streamMetaRef.current = null;
  }, []);

  const recordLocalListening = useCallback((track, meta = {}) => {
    const userId = listeningUserIdRef.current;
    if (!userId || !track?.slug) return;
    if (meta.completed) {
      clearPlaybackPosition(userId, track.slug);
    }
    recordListeningEvent(
      track.slug,
      {
        title: track.title,
        cover: track.cover,
        positionSeconds: meta.positionSeconds ?? 0,
        durationSeconds: meta.durationSeconds ?? 0,
        completed: Boolean(meta.completed),
      },
      userId
    );
  }, []);

  const patchState = useCallback((patch) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  const stopProgressRaf = useCallback(() => {
    if (progressRafRef.current != null) {
      cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
  }, []);

  const startProgressRaf = useCallback(() => {
    stopProgressRaf();
    const tick = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused || audio.ended) {
        stopProgressRaf();
        return;
      }
      const t = audio.currentTime || 0;
      const prev = stateRef.current;
      if (Math.abs(t - prev.currentTime) >= 0.001) {
        patchState({ currentTime: t });
      }
      progressRafRef.current = requestAnimationFrame(tick);
    };
    progressRafRef.current = requestAnimationFrame(tick);
  }, [patchState, stopProgressRaf]);

  const postKeepAliveToServiceWorker = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
    try {
      navigator.serviceWorker.controller.postMessage({ type: "KEEP_ALIVE" });
    } catch {
      /* SW ping best-effort */
    }
  }, []);

  const stopKeepAlivePing = useCallback(() => {
    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }
  }, []);

  const startKeepAlivePing = useCallback(() => {
    stopKeepAlivePing();
    postKeepAliveToServiceWorker();
    keepAliveIntervalRef.current = setInterval(
      postKeepAliveToServiceWorker,
      KEEP_ALIVE_INTERVAL_MS
    );
  }, [postKeepAliveToServiceWorker, stopKeepAlivePing]);

  const syncPositionState = useCallback((force = false) => {
    const audio = audioRef.current;
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      !navigator.mediaSession?.setPositionState ||
      !audio ||
      !isFinite(audio.duration) ||
      audio.duration <= 0
    ) {
      return;
    }
    const now = Date.now();
    if (!force && now - lastPositionStateAtRef.current < POSITION_STATE_THROTTLE_MS) {
      return;
    }
    lastPositionStateAtRef.current = now;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(0, audio.currentTime), audio.duration),
      });
    } catch {
      /* unsupported duration/position combo */
    }
  }, []);

  const updateMediaSession = useCallback(async (track, { playing } = {}) => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!track) return;

    const coverForSession =
      csModeRef.current && (track.csCover || track.cs_cover)
        ? track.csCover || track.cs_cover
        : track.cover || track.coverArt || track.coverUrl || track.baseCover || "";
    const artwork = await getArtworkEntriesForTrack(coverForSession, track.slug);
    try {
      ms.metadata = new MediaMetadata({
        title: csModeRef.current ? `${track.title || "Untitled"} ◈` : (track.title || "Untitled"),
        artist: track.artist || "2MRRW",
        album: track.album || "2MRRW",
        artwork,
      });
      ms.playbackState = playing ? "playing" : "paused";
    } catch {
      /* MediaMetadata unsupported */
    }

    const audio = audioRef.current;
    persistMediaSessionTrack(track, {
      playing,
      currentTime: audio?.currentTime ?? stateRef.current.currentTime,
      duration: isFinite(audio?.duration) ? audio.duration : stateRef.current.duration,
    });
    syncPositionState(true);
  }, [syncPositionState]);

  const rehydrateMediaSession = useCallback(() => {
    const s = stateRef.current;
    if (!s.currentTrack || !s.hasStarted) return;
    void updateMediaSession(s.currentTrack, { playing: s.isPlaying });
    syncPositionState(true);
  }, [updateMediaSession, syncPositionState]);

  const initWebAudio = useCallback(() => {
    if (webAudioInitializedRef.current || typeof window === "undefined") return;
    const audio = audioRef.current;
    if (!audio) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      const source = ctx.createMediaElementSource(audio);
      const stereoPanner = ctx.createStereoPanner();
      stereoPanner.pan.value = 0;
      const bassFilter = ctx.createBiquadFilter();
      bassFilter.type = "lowshelf";
      bassFilter.frequency.value = 200;
      bassFilter.gain.value = 0;
      source.connect(analyser);
      analyser.connect(stereoPanner);
      stereoPanner.connect(bassFilter);
      bassFilter.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;
      stereoPannerRef.current = stereoPanner;
      bassFilterRef.current = bassFilter;
      webAudioInitializedRef.current = true;
      webAudioAvailableRef.current = true;
    } catch (err) {
      console.warn("[AUDIO] Web Audio graph init failed, routing direct:", err?.message || err);
      try {
        sourceRef.current?.disconnect();
      } catch {
        /* partial graph */
      }
      try {
        analyserRef.current?.disconnect();
      } catch {
        /* partial graph */
      }
      audioCtxRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
      stereoPannerRef.current = null;
      bassFilterRef.current = null;
      webAudioInitializedRef.current = false;
      webAudioAvailableRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const unlockFromGesture = async () => {
      if (sessionUnlockedRef.current) return;
      sessionUnlockedRef.current = true;

      const audio = audioRef.current;
      if (audio) {
        try {
          audio.load();
        } catch {
          /* Android session priming */
        }
      }

      initWebAudio();
      await resumeWebAudioContextIfSuspended(audioCtxRef);

      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx && !audioCtxRef.current) {
          const ephemeral = new Ctx();
          if (ephemeral.state === "suspended") {
            await ephemeral.resume();
          }
          await ephemeral.close();
        }
      } catch {
        /* iOS unlock best-effort */
      }

      GESTURE_UNLOCK_EVENTS.forEach((evt) => {
        document.removeEventListener(evt, unlockFromGesture, true);
      });
    };

    GESTURE_UNLOCK_EVENTS.forEach((evt) => {
      document.addEventListener(evt, unlockFromGesture, { capture: true, passive: true });
    });

    return () => {
      GESTURE_UNLOCK_EVENTS.forEach((evt) => {
        document.removeEventListener(evt, unlockFromGesture, true);
      });
    };
  }, [initWebAudio]);

  const toggleSpaceMode = useCallback(() => {
    const next = !stateRef.current.spaceMode;
    patchState({ spaceMode: next });
  }, [patchState]);

  const toggleBassBoost = useCallback(() => {
    const next = !stateRef.current.bassMode;
    if (bassFilterRef.current && webAudioAvailableRef.current) {
      bassFilterRef.current.gain.setTargetAtTime(
        next ? 8 : 0,
        bassFilterRef.current.context.currentTime,
        0.1
      );
    }
    patchState({ bassMode: next });
  }, [patchState]);

  const cycleAtmosphere = useCallback(() => {
    const current = stateRef.current.atmosphereLevel ?? 3;
    const next = current <= 1 ? 3 : current - 1;
    patchState({ atmosphereLevel: next });
  }, [patchState]);

  useEffect(() => {
    stateRef.current = state;
    queueRef.current = state.queue || [];
    queueIndexRef.current = state.queueIndex ?? -1;
    repeatModeRef.current = state.repeatMode || "off";
    shuffleRef.current = Boolean(state.shuffle);
    csModeRef.current = Boolean(state.csMode);
    notifyMediaEngineBridge();
  }, [state]);

  useEffect(() => {
    registerMediaEngineBridge({
      getState: () => {
        const s = stateRef.current;
        const el = audioRef.current;
        const volume = el && typeof el.volume === "number" ? el.volume : 1;
        return {
          currentTrack: mapContextTrackToMediaTrack(s.currentTrack),
          isPlaying: Boolean(s.isPlaying),
          currentTime: s.currentTime ?? 0,
          duration: s.duration ?? 0,
          volume,
          queue: s.queue ?? [],
          playbackState: s.playbackState,
          csMode: s.csMode,
          spaceMode: s.spaceMode,
          bassMode: s.bassMode,
          atmosphereLevel: s.atmosphereLevel,
        };
      },
      getAnalyser: () => (webAudioAvailableRef.current ? analyserRef.current : null),
    });
    return () => registerMediaEngineBridge(null);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const persistPlayback = (eventType = "progress") => {
      setState(prev => {
        const track = prev.currentTrack;
        if (!track?.slug) return prev;
        const now = Date.now();
        const key = `${track.slug}:${eventType}`;
        if (eventType === "progress" && lastPersistRef.current.key === track.slug && now - lastPersistRef.current.at < 15000) {
          return prev;
        }
        lastPersistRef.current = { key: eventType === "progress" ? track.slug : key, at: now };
        fetch("/api/media/playback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          keepalive: true,
          body: JSON.stringify({
            slug: track.slug,
            title: track.title,
            eventType,
            mediaType: "audio",
            source: track.source,
            positionSeconds: audio.currentTime,
            durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
            completed: eventType === "complete",
          }),
        }).catch(() => {});
        sendControlSystemPlaybackEvent(track, eventType, {
          mediaType: "audio",
          positionSeconds: audio.currentTime,
          durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
          completed: eventType === "complete",
        });
        return prev;
      });
    };

    const onWaiting = () => patchState({ isBuffering: true });
    const onStalled = () => patchState({ isBuffering: true });
    const onPlaying = () => {
      patchState({ isBuffering: false });
      perfMark(MARKS.AUDIO_START_LATENCY_END);
      perfMeasure("audio-start-latency", MARKS.AUDIO_START_LATENCY_START, MARKS.AUDIO_START_LATENCY_END);
    };
    const onCanPlayThrough = () => patchState({ isBuffering: false });

    const onPlay = () => {
      userPausedRef.current = false;
      patchState({ isPlaying: true, error: null, hasStarted: true, isBuffering: false });
      startKeepAlivePing();
      startProgressRaf();
      startPositionSaveTimer();
      persistPlayback("play");
      const track = stateRef.current.currentTrack;
      if (track) {
        listeningProgressRef.current = { slug: track.slug, recorded30s: false };
        recordLocalListening(track, {
          positionSeconds: audio.currentTime || 0,
          durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
          completed: false,
        });
        void updateMediaSession(track, { playing: true });
      }
    };

    const onPause = () => {
      const userInitiated = userPausedRef.current;
      userPausedRef.current = false;

      if (skipPauseInterruptionRef.current) {
        skipPauseInterruptionRef.current = false;
        return;
      }

      stopKeepAlivePing();
      stopProgressRaf();
      stopPositionSaveTimer();
      patchState({ isPlaying: false });
      persistPlayback("pause");

      const track = stateRef.current.currentTrack;
      if (track) {
        void updateMediaSession(track, { playing: false });
      } else if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
      }

      if (!userInitiated && track && audio.paused) {
        const resumeAfterInterrupt = () => {
          if (stateRef.current.isPlaying && audio.paused) {
            audio.play().catch(() => {});
          }
          audio.removeEventListener("canplay", resumeAfterInterrupt);
        };
        audio.addEventListener("canplay", resumeAfterInterrupt);
      }
    };

    const onTime = () => {
      persistPlayback("progress");
      syncPositionState(false);

      const track = stateRef.current.currentTrack;
      const previewOnly = track?.metadata?.access?.previewOnly;

      if (previewOnly && audio.currentTime >= PREVIEW_HARD_CAP_SEC - 2) {
        const fadeStart = PREVIEW_HARD_CAP_SEC - 2;
        const elapsed = audio.currentTime - fadeStart;
        const fadeProgress = Math.min(1, elapsed / 2);
        audio.volume = Math.max(0, 1 - fadeProgress);

        if (audio.currentTime >= PREVIEW_HARD_CAP_SEC) {
          skipPauseInterruptionRef.current = true;
          audio.pause();
          audio.volume = 1;
          audio.currentTime = PREVIEW_HARD_CAP_SEC;
          patchState({
            isPlaying: false,
            currentTime: PREVIEW_HARD_CAP_SEC,
            playbackState: "ended_preview",
          });
          setPreviewEnded(true);
          onPreviewEndedRef.current?.(track);
          dispatchPreviewEnded(track.slug);
        }
        return;
      }

      if (previewOnly && audio.volume < 1 && audio.currentTime < PREVIEW_HARD_CAP_SEC - 2) {
        audio.volume = 1;
      }

      if (track?.slug && audio.currentTime >= 30) {
        if (listeningProgressRef.current.slug !== track.slug) {
          listeningProgressRef.current = { slug: track.slug, recorded30s: false };
        }
        if (!listeningProgressRef.current.recorded30s) {
          listeningProgressRef.current.recorded30s = true;
          recordLocalListening(track, {
            positionSeconds: audio.currentTime,
            durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
            completed: false,
          });
        }
      }
    };

    const onDuration = () => patchState({ duration: isFinite(audio.duration) ? audio.duration : 0 });
    const onEnded = () => {
      const track = stateRef.current.currentTrack;
      const previewOnly = track?.metadata?.access?.previewOnly;

      if (Date.now() < spuriousEndedGuardRef.current) {
        const dur = isFinite(audio.duration) ? audio.duration : 0;
        if (dur > 0 && audio.currentTime >= dur - RESTORE_NEAR_END_BUFFER_SEC) {
          audio.currentTime = Math.max(0, dur - RESTORE_NEAR_END_BUFFER_SEC - 0.5);
        } else {
          audio.currentTime = 0;
        }
        patchState({
          playbackState: stateRef.current.playbackState === "ending" ? null : stateRef.current.playbackState,
          currentTime: audio.currentTime,
        });
        return;
      }

      if (previewOnly) {
        stopProgressRaf();
        stopPositionSaveTimer();
        patchState({ isPlaying: false, currentTime: PREVIEW_HARD_CAP_SEC, playbackState: "ended_preview" });
        setPreviewEnded(true);
        onPreviewEndedRef.current?.(track);
        dispatchPreviewEnded(track?.slug);
        if (track) void updateMediaSession(track, { playing: false });
        return;
      }

      const meta = streamMetaRef.current;
      if (meta) {
        finalizeStreamSession(meta, {
          completed: true,
          durationSeconds: isFinite(audio.duration) ? audio.duration : audio.currentTime,
        });
      }
      if (track?.slug) {
        recordLocalListening(track, {
          positionSeconds: isFinite(audio.duration) ? audio.duration : audio.currentTime,
          durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
          completed: true,
        });
        listeningProgressRef.current = { slug: null, recorded30s: false };
      }
      stopProgressRaf();
      stopPositionSaveTimer();
      persistPlayback("complete");
      patchState({ playbackState: "ending" });

      const repeatMode = repeatModeRef.current;
      const queue = queueRef.current;
      const queueIndex = queueIndexRef.current;

      const finishEnded = () => {
        if (repeatMode === "one" && stateRef.current.currentTrack) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
          return;
        }

        if (queue.length > 0) {
          let nextIndex = queueIndex + 1;
          if (shuffleRef.current && queue.length > 1) {
            let candidate = Math.floor(Math.random() * queue.length);
            while (candidate === queueIndex) {
              candidate = Math.floor(Math.random() * queue.length);
            }
            nextIndex = candidate;
          } else if (nextIndex >= queue.length) {
            if (repeatMode === "all") nextIndex = 0;
            else {
              patchState({ isPlaying: false, currentTime: 0, playbackState: "idle" });
              setPreviewEnded(false);
              if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
                navigator.mediaSession.playbackState = "none";
              }
              if (track) void updateMediaSession(track, { playing: false });
              return;
            }
          }
          const nextTrack = queue[nextIndex];
          if (nextTrack) {
            queueIndexRef.current = nextIndex;
            patchState({ queueIndex: nextIndex, playbackState: "playing" });
            void playTrackRef.current?.(nextTrack, { resumeAt: 0 }).then((ok) => {
              if (ok && csModeRef.current) void applyCSModeToTrackRef.current?.(nextTrack);
            });
            return;
          }
        }

        patchState({ isPlaying: false, currentTime: 0, playbackState: "idle" });
        setPreviewEnded(false);
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
        if (track) void updateMediaSession(track, { playing: false });
      };

      setTimeout(finishEnded, 2000);
    };
    const onError = async () => {
      const track = stateRef.current.currentTrack;
      const slug = track?.slug || streamMetaRef.current?.slug;
      const at = new Date().toISOString();
      console.error("[stream] playback error", { trackId: track?.id || slug, slug, at });

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const onOnline = () => {
          window.removeEventListener("online", onOnline);
          const current = stateRef.current.currentTrack;
          if (current) {
            streamErrorRetriedRef.current = false;
            void playTrackRef.current?.(current, {
              resumeAt: audio.currentTime || 0,
              forceStream: true,
            });
          }
        };
        window.addEventListener("online", onOnline);
        patchState({ error: "RECONNECTING", isBuffering: true });
        return;
      }

      const meta = streamMetaRef.current;
      const resumeAt = audio.currentTime || 0;

      if (slug && streamMetaRef.current && !streamErrorRetriedRef.current) {
        streamErrorRetriedRef.current = true;
        try {
          const data = await fetchLibraryStream(slug, { force: false });
          streamMetaRef.current = {
            slug,
            url: data.url,
            fetchedAt: Date.now(),
            expiresIn: data.expiresIn || 3600,
            streamEventId: data.streamEventId || meta?.streamEventId || null,
            sessionId: data.sessionId || meta?.sessionId || null,
          };
          skipPauseInterruptionRef.current = true;
          await waitAudioSrcReady(audio, data.url);
          if (resumeAt > 0) {
            const seekAfterLoad = () => {
              if (resumeAt > 0 && isFinite(audio.duration)) {
                audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
              }
              audio.removeEventListener("loadedmetadata", seekAfterLoad);
            };
            audio.addEventListener("loadedmetadata", seekAfterLoad);
            if (isFinite(audio.duration) && audio.duration > 0) seekAfterLoad();
          }
          try {
            await audio.play();
          } catch (e) {
            if (e.name !== "AbortError") {
              console.error("[AUDIO]", e.name, e.message);
            }
          }
          patchState({ isPlaying: true, error: null, streamRetryable: false, isBuffering: false });
          return;
        } catch (retryErr) {
          if (retryErr?.status === 401 && track?.metadata?.access?.canStream) {
            console.warn("[AudioContext] stream retry 401; falling back to preview", {
              slug: track?.slug || slug,
              trackId: track?.id || slug,
            });
            const previewFallbackSrc = track?.metadata?.previewSrc || track?.previewUrl || null;
            if (previewFallbackSrc) {
              skipPauseInterruptionRef.current = true;
              await loadAudioSrcAndPlay(audio, previewFallbackSrc);
              patchState({
                isPlaying: true,
                error: null,
                source: "preview",
                playbackState: "preview_fallback",
                currentTrack: {
                  ...track,
                  src: previewFallbackSrc,
                  metadata: {
                    ...(track.metadata || {}),
                    access: {
                      ...(track.metadata?.access || {}),
                      previewOnly: true,
                    },
                  },
                },
              });
              return;
            }
          }
          if (retryErr?.code === "ACCESS_DENIED") {
            finalizeStreamSession(meta, { durationSeconds: resumeAt, completed: false });
            skipPauseInterruptionRef.current = true;
            audio.pause();
            patchState({
              isPlaying: false,
              accessDenied: true,
              streamRetryable: false,
              error: "Access unavailable",
            });
            return;
          }
        }
      }

      if (meta) {
        finalizeStreamSession(meta, {
          completed: false,
          durationSeconds: resumeAt,
        });
      }
      patchState({
        isPlaying: false,
        error: "Stream unavailable — tap to retry",
        streamRetryable: true,
        isBuffering: false,
      });
    };
    const onEmptied = () => {
      stopProgressRaf();
      patchState({ currentTime: 0, duration: 0 });
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("emptied", onEmptied);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("canplaythrough", onCanPlayThrough);

    const onOnline = () => {
      if (stateRef.current.isPlaying && stateRef.current.currentTrack) {
        console.log("[AUDIO] Network restored — resuming");
        void retryStreamPlaybackRef.current?.();
      }
    };
    window.addEventListener("online", onOnline);

    let onDeviceChange = null;
    if (navigator.mediaDevices?.addEventListener) {
      onDeviceChange = async () => {
        try {
          if (!navigator.mediaDevices?.enumerateDevices) return;
          await navigator.mediaDevices.enumerateDevices();
        } catch {
          /* enumerateDevices unavailable */
        }
      };
      navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    }

    return () => {
      window.removeEventListener("online", onOnline);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("emptied", onEmptied);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("canplaythrough", onCanPlayThrough);
      if (onDeviceChange && navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
      }
      stopProgressRaf();
      stopPositionSaveTimer();
      stopKeepAlivePing();
      resetPlaybackTelemetry();
    };
  }, [
    patchState,
    updateMediaSession,
    syncPositionState,
    recordLocalListening,
    finalizeStreamSession,
    startPositionSaveTimer,
    stopPositionSaveTimer,
    startProgressRaf,
    stopProgressRaf,
    startKeepAlivePing,
    stopKeepAlivePing,
  ]);

  const applyCsToElement = useCallback((audio, presentation, resumeAt = null) => {
    if (!audio || !presentation) return;
    audio.playbackRate = presentation.playbackRate ?? 1;
    if (typeof audio.preservesPitch !== "undefined") {
      audio.preservesPitch = true;
    }
    csUsingAlternateSrcRef.current = Boolean(presentation.useCsSrc);
    const applySeek = () => {
      if (resumeAt != null && resumeAt > 0 && isFinite(audio.duration)) {
        audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
      }
      audio.removeEventListener("loadedmetadata", applySeek);
    };
    if (resumeAt != null && resumeAt > 0) {
      audio.addEventListener("loadedmetadata", applySeek);
      if (isFinite(audio.duration) && audio.duration > 0) applySeek();
    }
  }, []);

  const resolveLibraryStreamForTrack = useCallback(async (track, { force = false } = {}) => {
    const slug = parseStreamSlugFromSrc(track.src) || track.slug;
    if (!slug || !isLibraryStreamSrc(track.src)) return { track, meta: null };

    const data = await fetchLibraryStream(slug, { force });
    const meta = {
      slug,
      url: data.url,
      fetchedAt: Date.now(),
      expiresIn: data.expiresIn || 3600,
      streamEventId: data.streamEventId || null,
      sessionId: data.sessionId || null,
    };
    streamMetaRef.current = meta;
    return {
      track: { ...track, src: data.url },
      meta,
    };
  }, []);

  const unlockAudioFromGesture = useCallback(async (audioEl) => {
    if (!audioEl || !audioEl.paused) return;
    try {
      const vol = audioEl.volume;
      audioEl.volume = 0;
      await audioEl.play();
      audioEl.pause();
      audioEl.volume = vol;
    } catch {
      /* unlock failure is non-fatal */
    }
  }, []);

  const playTrack = useCallback(async (track, options = {}) => {
    const audioEl = audioRef.current;
    if (audioEl?.paused) {
      void unlockAudioFromGesture(audioEl);
    }

    initWebAudio();
    await resumeWebAudioContextIfSuspended(audioCtxRef);
    setPreviewEnded(false);
    if (!track || (typeof track !== "object")) {
      console.error("[AudioContext] playTrack: invalid track", track);
      return false;
    }
    const normalized = normalizeTrack(track);
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

    preloadCoverImage(nextTrack.cover || nextTrack.baseCover, {
      coverArtType: nextTrack.coverArtType,
    });
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
        hasStarted: true,
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
        hasStarted: true,
      });
      return false;
    }

    streamErrorRetriedRef.current = false;

    const streamSlug = parseStreamSlugFromSrc(nextTrack.src) || nextTrack.slug;
    const usesLibraryStream = isLibraryStreamSrc(nextTrack.src);
    const redirectFastPath = isLibraryStreamRedirectSrc(nextTrack.src);
    const previewSrc = getTrackPreviewSrc(nextTrack);

    let syncSrc = nextTrack.src;
    let backgroundStreamResolve = false;

    if (usesLibraryStream && streamSlug) {
      const entitledFullStream = Boolean(nextTrack.metadata?.access?.canStream);
      if (previewSrc && !entitledFullStream) {
        syncSrc = previewSrc;
      } else if (redirectFastPath) {
        syncSrc = nextTrack.src;
      } else if (entitledFullStream) {
        backgroundStreamResolve = true;
      }
    }

    const applyStreamResolveError = (err) => {
      if (err?.status === 401 && nextTrack?.metadata?.access?.canStream) {
        console.warn("[AudioContext] stream fetch 401; falling back to preview", {
          slug: nextTrack.slug,
          trackId: nextTrack.id,
        });
        const previewFallbackSrc = nextTrack?.metadata?.previewSrc || nextTrack?.previewUrl || null;
        if (previewFallbackSrc) {
          skipPauseInterruptionRef.current = true;
          void loadAudioSrcAndPlay(audio, previewFallbackSrc);
          patchState({
            isPlaying: true,
            error: null,
            source: "preview",
            playbackState: "preview_fallback",
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
          return;
        }
      }
      if (err?.code === "ACCESS_DENIED") {
        const prevMeta = streamMetaRef.current;
        if (prevMeta) finalizeStreamSession(prevMeta, { completed: false, durationSeconds: audio.currentTime || 0 });
        skipPauseInterruptionRef.current = true;
        audio.pause();
        patchState({
          isPlaying: false,
          accessDenied: true,
          streamRetryable: false,
          error: "Access unavailable",
          hasStarted: true,
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
        });
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
          hasStarted: true,
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
        });
        return;
      }
      patchState({
        isPlaying: false,
        error: "Stream unavailable — tap to retry",
        streamRetryable: true,
        hasStarted: true,
        currentTrack: nextTrack,
        currentTrackId: nextTrack.id,
      });
    };

    const swapToSignedStream = async (resolved) => {
      const signedUrl = resolved.track?.src;
      if (!signedUrl || signedUrl === syncSrc) return;
      const resumeAt = audio.currentTime || 0;
      skipPauseInterruptionRef.current = true;
      await waitAudioSrcReady(audio, signedUrl);
      const applySeek = () => {
        if (resumeAt > 0 && isFinite(audio.duration)) {
          audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
        }
        audio.removeEventListener("loadedmetadata", applySeek);
      };
      audio.addEventListener("loadedmetadata", applySeek);
      if (isFinite(audio.duration) && audio.duration > 0) applySeek();
      if (stateRef.current.isPlaying) await playAudioIfNotPaused(audio, stateRef.current.isPlaying);
      patchState({
        currentTrack: {
          ...nextTrack,
          src: signedUrl,
          metadata: {
            ...nextTrack.metadata,
            access: {
              ...(nextTrack.metadata?.access || {}),
              previewOnly: false,
              canStream: true,
            },
          },
        },
      });
    };

    if (backgroundStreamResolve && streamSlug) {
      void resolveLibraryStreamForTrack(nextTrack, { force: options.forceStream })
        .then((resolved) => swapToSignedStream(resolved))
        .catch(applyStreamResolveError);
    }

    const userId = listeningUserIdRef.current;
    const previousLastPlayedSlug = lastPlayedSlugRef.current;
    const playedDifferentSince =
      previousLastPlayedSlug != null && previousLastPlayedSlug !== nextTrack.slug;
    if (playedDifferentSince && userId) {
      clearPlaybackPosition(userId, previousLastPlayedSlug);
    }
    lastPlayedSlugRef.current = nextTrack.slug;

    let resumeAt =
      options.resumeAt != null && options.resumeAt > RESTORE_MIN_POSITION_SEC
        ? options.resumeAt
        : null;
    if (options.resumeAt === 0) {
      resumeAt = null;
      if (userId && streamSlug) clearPlaybackPosition(userId, streamSlug);
    }
    if (playedDifferentSince && userId && streamSlug) {
      clearPlaybackPosition(userId, streamSlug);
    }
    if (!resumeAt && !playedDifferentSince && userId && streamSlug) {
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
    if (!resumeAt && !playedDifferentSince && accountState?.mediaProgress?.length) {
      const savedProgress = accountState.mediaProgress.find(
        (p) => p.product_slug === nextTrack.slug && !p.completed
      );
      if (savedProgress?.position_seconds > RESTORE_MIN_POSITION_SEC) {
        const clamped = clampRestorePosition(
          savedProgress.position_seconds,
          savedProgress.duration_seconds
        );
        if (clamped != null) resumeAt = clamped;
      }
    }
    if (resumeAt != null && isFinite(audio.duration) && audio.duration > 0) {
      resumeAt = clampRestorePosition(resumeAt, audio.duration);
    }

    const prevTrack = stateRef.current.currentTrack;
    const sameIdentity =
      (prevTrack?.slug && nextTrack.slug && prevTrack.slug === nextTrack.slug) ||
      stateRef.current.currentTrackId === nextTrack.id;
    const isSameTrack = sameIdentity;
    const isReplay = isSameTrack && audio.ended;
    const previousTrack = stateRef.current.currentTrack;

    if (isReplay) {
      audio.currentTime = 0;
      pendingSeekRef.current = null;
      patchState({ playbackState: null, currentTime: 0 });
    }

    if (
      previousTrack?.slug &&
      previousTrack.slug !== nextTrack.slug &&
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
      listeningProgressRef.current = { slug: null, recorded30s: false };
    }

    patchState({
      currentTrackId: nextTrack.id,
      currentTrack: { ...nextTrack, src: syncSrc },
      source: nextTrack.source,
      error: null,
      accessDenied: false,
      streamRetryable: false,
      streamConflict: null,
      hasStarted: true,
      csTrack: csModeRef.current ? normalized : null,
      playbackState: null,
    });

    preloadCsAssets(normalized, { csImgRef, csVidRef, csAudioRef });

    try {
      if (
        !isSameTrack &&
        stateRef.current.isPlaying &&
        audio.currentTime > 3 &&
        !audio.paused
      ) {
        const startVol = audio.volume > 0 ? audio.volume : 1;
        await new Promise((resolve) => {
          const fadeOut = setInterval(() => {
            audio.volume = Math.max(0, audio.volume - startVol / 10);
            if (audio.volume <= 0) {
              clearInterval(fadeOut);
              audio.volume = startVol;
              resolve();
            }
          }, 30);
          setTimeout(() => {
            clearInterval(fadeOut);
            audio.volume = startVol;
            resolve();
          }, 300);
        });
      }

      if (!isSameTrack) {
        skipPauseInterruptionRef.current = true;
        audio.pause();
        spuriousEndedGuardRef.current = Date.now() + SPURIOUS_ENDED_GUARD_MS;
        await loadAudioSrcAndPlay(audio, syncSrc);
        pendingSeekRef.current = resumeAt;
      } else {
        if (!audio.paused && stateRef.current.isPlaying) {
          applyCsToElement(audio, presentation, pendingSeekRef.current || null);
          return true;
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

      if (pendingSeekRef.current) {
        const applyPendingSeek = () => {
          const pending = pendingSeekRef.current;
          if (pending != null && isFinite(audio.duration) && audio.duration > 0) {
            const safe = clampRestorePosition(pending, audio.duration);
            if (safe != null) {
              audio.currentTime = safe;
            } else if (listeningUserIdRef.current && nextTrack.slug) {
              clearPlaybackPosition(listeningUserIdRef.current, nextTrack.slug);
            }
            spuriousEndedGuardRef.current = Date.now() + SPURIOUS_ENDED_GUARD_MS;
          }
          pendingSeekRef.current = null;
          audio.removeEventListener("loadedmetadata", applyPendingSeek);
        };
        audio.addEventListener("loadedmetadata", applyPendingSeek);
      }

      if (isFirstListen(nextTrack.slug)) {
        markListened(nextTrack.slug);
        audio.volume = 0;
        let vol = 0;
        const swell = setInterval(() => {
          vol = Math.min(1, vol + 0.033);
          audio.volume = vol;
          if (vol >= 1) clearInterval(swell);
        }, 100);
      }

      if (isSameTrack) {
        try {
          await audio.play();
        } catch (e) {
          if (e.name !== "AbortError") {
            console.error("[AUDIO]", e.name, e.message);
          }
        }
      }
      void updateMediaSession({ ...nextTrack, src: syncSrc }, { playing: true });

      if (isReplay) {
        sendControlSystemPlaybackEvent(nextTrack, "replay", {
          mediaType: "audio",
          positionSeconds: 0,
          durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
        });
      }
      patchState({ isPlaying: true, error: null, playbackState: "playing" });
      return true;
    } catch {
      patchState({ isPlaying: false, error: "Audio playback failed. Try again in a moment.", playbackState: "paused" });
      void updateMediaSession(nextTrack, { playing: false });
      return false;
    }
  }, [
    patchState,
    updateMediaSession,
    applyCsToElement,
    recordLocalListening,
    resolveLibraryStreamForTrack,
    finalizeStreamSession,
    initWebAudio,
    unlockAudioFromGesture,
    accountState?.mediaProgress,
  ]);

  const upgradeToFullStream = useCallback(async () => {
    const audio = audioRef.current;
    const track = stateRef.current.currentTrack;
    if (!audio || !track?.slug) return false;
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

    const libraryTrack = {
      ...track,
      src: `/api/library/stream?slug=${encodeURIComponent(track.slug)}&redirect=1`,
    };

    try {
      const resolved = await resolveLibraryStreamForTrack(libraryTrack, { force: false });
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
      const resumeAt = audio.currentTime || 0;
      skipPauseInterruptionRef.current = true;
      await waitAudioSrcReady(audio, resolved.track.src);
      const applySeek = () => {
        if (resumeAt > 0 && isFinite(audio.duration)) {
          audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
        }
        audio.removeEventListener("loadedmetadata", applySeek);
      };
      audio.addEventListener("loadedmetadata", applySeek);
      if (isFinite(audio.duration) && audio.duration > 0) applySeek();
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
      if (!audio.paused) await playAudioIfNotPaused(audio, stateRef.current.isPlaying);
      return true;
    } catch (err) {
      if (err?.code === "ACCESS_DENIED") {
        patchState({ accessDenied: true, error: "Access unavailable" });
      }
      return false;
    }
  }, [patchState, resolveLibraryStreamForTrack]);

  useEffect(() => {
    const onEntitlementsUpdated = () => {
      const track = stateRef.current.currentTrack;
      const meta = track?.metadata?.access;
      if (meta?.previewOnly && stateRef.current.isPlaying) {
        void upgradeToFullStream();
      }
    };
    window.addEventListener("entitlements:updated", onEntitlementsUpdated);
    return () => window.removeEventListener("entitlements:updated", onEntitlementsUpdated);
  }, [upgradeToFullStream]);

  const setOnPreviewEnded = useCallback((handler) => {
    onPreviewEndedRef.current = typeof handler === "function" ? handler : null;
  }, []);

  const overrideConcurrentStream = useCallback(async () => {
    const conflict = stateRef.current.streamConflict;
    if (!conflict?.track) return false;
    patchState({ streamConflict: null });
    return playTrack(conflict.track, {
      resumeAt: conflict.resumeAt,
      forceStream: true,
    });
  }, [patchState, playTrack]);

  const dismissStreamConflict = useCallback(() => {
    patchState({ streamConflict: null });
  }, [patchState]);

  const retryStreamPlayback = useCallback(async () => {
    const track = stateRef.current.currentTrack;
    if (!track) return false;
    streamErrorRetriedRef.current = false;
    patchState({ error: null, streamRetryable: false, accessDenied: false });
    const resumeAt = audioRef.current?.currentTime || stateRef.current.currentTime || 0;
    return playTrack(track, { resumeAt, forceStream: true });
  }, [patchState, playTrack]);

  useEffect(() => {
    retryStreamPlaybackRef.current = retryStreamPlayback;
  }, [retryStreamPlayback]);

  const applyCSModeToTrack = useCallback(
    async (track) => {
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
    },
    [applyCsToElement, patchState, updateMediaSession]
  );

  const toggleCSMode = useCallback(async () => {
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
        try {
          await audio.play();
        } catch (e) {
          if (e.name !== "AbortError") {
            console.error("[AUDIO]", e.name, e.message);
          }
        }
      }
      syncPositionState(true);
    } catch {
      csModeRef.current = !next;
      patchState({ error: "Could not apply chopped & slowed mode.", csMode: !next });
    }
    return next;
  }, [patchState, updateMediaSession, applyCsToElement, syncPositionState]);

  useEffect(() => {
    playTrackRef.current = playTrack;
    applyCSModeToTrackRef.current = applyCSModeToTrack;
  });

  const setQueue = useCallback((tracks = [], startIndex = 0) => {
    const normalized = (tracks || []).map(normalizeTrack).filter((t) => t.src);
    const index = Math.max(0, Math.min(startIndex, normalized.length - 1));
    queueRef.current = normalized;
    queueIndexRef.current = normalized.length ? index : -1;
    perfMark(MARKS.QUEUE_UPDATE_START);
    // perf: startTransition — queue update is non-urgent
    startTransition(() => {
      patchState({ queue: normalized, queueIndex: queueIndexRef.current });
      perfMark(MARKS.QUEUE_UPDATE_END);
      perfMeasure("queue-update", MARKS.QUEUE_UPDATE_START, MARKS.QUEUE_UPDATE_END);
    });
    return normalized;
  }, [patchState]);

  const playNext = useCallback(async () => {
    const queue = queueRef.current;
    if (!queue.length) return false;
    let nextIndex = queueIndexRef.current + 1;
    if (shuffleRef.current && queue.length > 1) {
      nextIndex = Math.floor(Math.random() * queue.length);
    } else if (nextIndex >= queue.length) {
      nextIndex = repeatModeRef.current === "all" ? 0 : queueIndexRef.current;
      if (nextIndex === queueIndexRef.current) return false;
    }
    queueIndexRef.current = nextIndex;
    patchState({ queueIndex: nextIndex });
    const track = queue[nextIndex];
    const ok = await playTrack(track, { resumeAt: 0 });
    if (ok && csModeRef.current) await applyCSModeToTrack(track);
    return ok;
  }, [playTrack, patchState, applyCSModeToTrack]);

  const playPrevious = useCallback(async () => {
    const queue = queueRef.current;
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      patchState({ currentTime: 0 });
      syncPositionState(true);
      return true;
    }
    if (!queue.length) return false;
    let prevIndex = queueIndexRef.current - 1;
    if (prevIndex < 0) prevIndex = repeatModeRef.current === "all" ? queue.length - 1 : 0;
    queueIndexRef.current = prevIndex;
    patchState({ queueIndex: prevIndex });
    const track = queue[prevIndex];
    const ok = await playTrack(track, { resumeAt: 0 });
    if (ok && csModeRef.current) await applyCSModeToTrack(track);
    return ok;
  }, [playTrack, patchState, syncPositionState, applyCSModeToTrack]);

  const setRepeatMode = useCallback((mode) => {
    const next = REPEAT_MODES.includes(mode) ? mode : "off";
    repeatModeRef.current = next;
    patchState({ repeatMode: next });
  }, [patchState]);

  const toggleRepeat = useCallback(() => {
    const order = ["off", "all", "one"];
    const current = repeatModeRef.current || "off";
    const next = order[(order.indexOf(current) + 1) % order.length];
    setRepeatMode(next);
    return next;
  }, [setRepeatMode]);

  const setShuffle = useCallback((enabled) => {
    shuffleRef.current = Boolean(enabled);
    patchState({ shuffle: Boolean(enabled) });
  }, [patchState]);

  const toggleShuffle = useCallback(() => {
    setShuffle(!shuffleRef.current);
    return shuffleRef.current;
  }, [setShuffle]);

  const playQueue = useCallback(async (tracks = [], startIndex = 0, options = {}) => {
    const normalized = setQueue(tracks, startIndex);
    if (!normalized.length) return false;
    return playTrack(normalized[Math.max(0, Math.min(startIndex, normalized.length - 1))], options);
  }, [setQueue, playTrack]);

  const pause = useCallback(() => {
    userPausedRef.current = true;
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(async () => {
    const audio = audioRef.current;
    const track = stateRef.current.currentTrack;
    if (!audio || !track) return false;

    userPausedRef.current = false;

    try {
      await unlockAudioFromGesture(audio);
      initWebAudio();
      await resumeWebAudioContextIfSuspended(audioCtxRef);
      await audio.play();
      if (track) void updateMediaSession(track, { playing: true });
      patchState({ isPlaying: true, error: null, accessDenied: false, playbackState: "playing" });

      const meta = streamMetaRef.current;
      const slug = meta?.slug || parseStreamSlugFromSrc(track.src) || track.slug;
      if (slug && meta && streamUrlNeedsRefresh(meta)) {
        void (async () => {
          try {
            const data = await fetchLibraryStream(slug, { force: false });
            streamMetaRef.current = {
              ...meta,
              url: data.url,
              fetchedAt: Date.now(),
              expiresIn: data.expiresIn || 3600,
              streamEventId: data.streamEventId || meta.streamEventId,
              sessionId: data.sessionId || meta.sessionId,
            };
            const resumeAt = audio.currentTime || 0;
            skipPauseInterruptionRef.current = true;
            await waitAudioSrcReady(audio, data.url);
            if (resumeAt > 0) {
              const seekAfterLoad = () => {
                if (resumeAt > 0 && isFinite(audio.duration)) {
                  audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
                }
                audio.removeEventListener("loadedmetadata", seekAfterLoad);
              };
              audio.addEventListener("loadedmetadata", seekAfterLoad);
              if (isFinite(audio.duration) && audio.duration > 0) seekAfterLoad();
            }
            if (!audio.paused) await playAudioIfNotPaused(audio, stateRef.current.isPlaying);
          } catch {
            /* stale URL refresh is best-effort */
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
  }, [patchState, updateMediaSession, finalizeStreamSession, initWebAudio, unlockAudioFromGesture]);

  const toggle = useCallback(() => {
    if (audioRef.current?.paused) return resume();
    pause();
    return false;
  }, [pause, resume]);

  const seek = useCallback((time) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    const track = stateRef.current.currentTrack;
    let capped = time;
    if (track?.metadata?.access?.previewOnly) {
      capped = Math.min(time, PREVIEW_HARD_CAP_SEC);
    }
    audio.currentTime = Math.max(0, Math.min(capped, isFinite(audio.duration) ? audio.duration : capped));
    patchState({ currentTime: audio.currentTime });
    syncPositionState(true);
    if (stateRef.current.currentTrack) {
      sendControlSystemPlaybackEvent(stateRef.current.currentTrack, "seek", {
        mediaType: "audio",
        positionSeconds: audio.currentTime,
        durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
      });
    }
  }, [patchState, syncPositionState]);

  const seekBack = useCallback((seconds = 15) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Math.max(0, (audio.currentTime || 0) - seconds);
    audio.currentTime = next;
    patchState({ currentTime: next });
    syncPositionState(true);
  }, [patchState, syncPositionState]);

  const seekForward = useCallback((seconds = 15) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (audio.currentTime || 0) + seconds;
    const next = Math.min(max, (audio.currentTime || 0) + seconds);
    audio.currentTime = next;
    patchState({ currentTime: next });
    syncPositionState(true);
  }, [patchState, syncPositionState]);

  const stop = useCallback(() => {
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
      audio.removeAttribute("src");
      audio.load();
    }
    csModeRef.current = false;
    csUsingAlternateSrcRef.current = false;
    streamMetaRef.current = null;
    setState(EMPTY_STATE);
    queueRef.current = [];
    queueIndexRef.current = -1;
    clearPersistedMediaSessionTrack();
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  }, [finalizeStreamSession, stopPositionSaveTimer, stopProgressRaf, stopKeepAlivePing]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return undefined;
    const ms = navigator.mediaSession;
    const handlePlay = () => {
      void resume();
    };
    const handlePause = () => {
      pause();
    };
    const handleNext = () => {
      void playNext();
    };
    const handlePrev = () => {
      void playPrevious();
    };
    const handleSeek = (details) => {
      if (details?.seekTime != null && Number.isFinite(details.seekTime)) {
        seek(details.seekTime);
      }
    };
    try {
      ms.setActionHandler("play", handlePlay);
      ms.setActionHandler("pause", handlePause);
      ms.setActionHandler("previoustrack", handlePrev);
      ms.setActionHandler("nexttrack", handleNext);
      ms.setActionHandler("seekto", handleSeek);
      ms.setActionHandler("stop", () => {
        stop();
      });
      ms.setActionHandler("seekbackward", (details) => {
        const skipTime = details?.seekOffset ?? 10;
        seek(Math.max(0, (audioRef.current?.currentTime || 0) - skipTime));
      });
      ms.setActionHandler("seekforward", (details) => {
        const skipTime = details?.seekOffset ?? 10;
        const dur = audioRef.current?.duration || 0;
        seek(Math.min(dur, (audioRef.current?.currentTime || 0) + skipTime));
      });
      try {
        ms.setActionHandler("togglemicrophone", () => {
          void toggleCSMode();
        });
      } catch {
        /* togglemicrophone not supported */
      }
    } catch {
      /* action handler not supported */
    }
    return () => {
      try {
        ms.setActionHandler("play", null);
        ms.setActionHandler("pause", null);
        ms.setActionHandler("previoustrack", null);
        ms.setActionHandler("nexttrack", null);
        ms.setActionHandler("seekto", null);
        ms.setActionHandler("stop", null);
        ms.setActionHandler("seekbackward", null);
        ms.setActionHandler("seekforward", null);
        ms.setActionHandler("togglemicrophone", null);
      } catch {
        /* ignore */
      }
    };
  }, [pause, resume, playNext, playPrevious, seek, stop, toggleCSMode]);

  useEffect(() => {
    const onVisibility = async () => {
      const audio = audioRef.current;
      const track = stateRef.current.currentTrack;

      if (document.visibilityState === "hidden") {
        if (!track || !stateRef.current.hasStarted || !audio) return;
        wasPlayingBeforeHideRef.current = stateRef.current.isPlaying && !audio.paused;
        const position = audio.currentTime || 0;
        const userId = listeningUserIdRef.current;
        if (userId && track.slug) {
          const dur = isFinite(audio.duration) ? audio.duration : 0;
          if (!(dur > 0 && isNearEndRestorePosition(position, dur))) {
            savePlaybackPosition(userId, track.slug, position, dur);
          }
        }
        const meta = streamMetaRef.current;
        const slug = meta?.slug || parseStreamSlugFromSrc(track.src) || track.slug;
        if (slug && meta && streamUrlNeedsRefresh(meta)) {
          void fetchLibraryStream(slug, { force: false })
            .then((data) => {
              streamMetaRef.current = {
                ...meta,
                url: data.url,
                fetchedAt: Date.now(),
                expiresIn: data.expiresIn || 3600,
                streamEventId: data.streamEventId || meta.streamEventId,
                sessionId: data.sessionId || meta.sessionId,
              };
            })
            .catch(() => {});
        }
        return;
      }

      if (document.visibilityState === "visible") {
        const shouldResume = wasPlayingBeforeHideRef.current;
        wasPlayingBeforeHideRef.current = false;

        if (shouldResume && audio) {
          const el = audioRef.current;
          if (el?.paused && stateRef.current.isPlaying) {
            void resumeWebAudioContextIfSuspended(audioCtxRef);
            el.play().catch(() => {});
          }
        }

        if (stateRef.current.currentTrack) {
          void updateMediaSession(stateRef.current.currentTrack, {
            playing: stateRef.current.isPlaying,
          });
        } else {
          rehydrateMediaSession();
        }
        syncPositionState(true);
      }
    };
    const onPageShow = (event) => {
      if (event.persisted || document.visibilityState === "visible") {
        const s = stateRef.current;
        if (s.currentTrack && s.hasStarted) {
          rehydrateMediaSession();
          return;
        }
        const persisted = readPersistedMediaSessionTrack();
        if (persisted?.slug && s.hasStarted) {
          rehydrateMediaSession();
        }
      }
    };
    const onBeforeUnload = () => {
      const s = stateRef.current;
      if (!s.currentTrack) return;
      persistMediaSessionTrack(s.currentTrack, {
        playing: s.isPlaying,
        currentTime: audioRef.current?.currentTime ?? s.currentTime,
        duration: audioRef.current?.duration ?? s.duration,
      });
      if (isStandalonePwa()) return;
    };

    const onPageHide = () => {
      const audioEl = audioRef.current;
      if (audioEl && stateRef.current.isPlaying) {
        const t = stateRef.current.currentTrack;
        const userId = listeningUserIdRef.current;
        if (userId && t?.slug) {
          const dur = isFinite(audioEl.duration) ? audioEl.duration : 0;
          const pos = audioEl.currentTime || 0;
          if (!(dur > 0 && isNearEndRestorePosition(pos, dur))) {
            savePlaybackPosition(userId, t.slug, pos, dur);
          }
        }
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [rehydrateMediaSession, patchState, updateMediaSession, syncPositionState]);

  const beginCsHoldPreview = useCallback((csAudioUrl) => {
    const audio = audioRef.current;
    if (!audio || !csAudioUrl || csModeRef.current || csHoldActiveRef.current) return;

    csHoldSavedRef.current = {
      src: audio.currentSrc || audio.src,
      currentTime: audio.currentTime,
      playbackRate: audio.playbackRate,
      wasPlaying: !audio.paused,
    };
    skipPauseInterruptionRef.current = true;
    audio.pause();
    void (async () => {
      await waitAudioSrcReady(audio, csAudioUrl);
      const seekTo = csHoldSavedRef.current.currentTime;
      const applySeek = () => {
        if (seekTo > 0 && isFinite(audio.duration)) {
          audio.currentTime = Math.min(seekTo, Math.max(0, audio.duration - 0.25));
        }
        audio.removeEventListener("loadedmetadata", applySeek);
      };
      audio.addEventListener("loadedmetadata", applySeek);
      if (isFinite(audio.duration) && audio.duration > 0) applySeek();
      audio.playbackRate = 1;
      if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
      if (csHoldSavedRef.current?.wasPlaying) {
        try {
          await audio.play();
        } catch (e) {
          if (e.name !== "AbortError") {
            console.error("[AUDIO]", e.name, e.message);
          }
        }
      }
    })();
    csHoldActiveRef.current = true;
  }, []);

  const setCsHoldPlaybackRate = useCallback((progress) => {
    const audio = audioRef.current;
    if (!audio || csModeRef.current || csHoldActiveRef.current) return;
    audio.playbackRate = 1 - (1 - CS_PLAYBACK_RATE) * progress;
    if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
  }, []);

  const endCsHoldPreview = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || csModeRef.current) return;

    const saved = csHoldSavedRef.current;
    if (csHoldActiveRef.current && saved) {
      const currentUrl = audio.currentSrc || audio.src;
      const savedUrl = saved.src ? new URL(saved.src, window.location.href).href : "";
      const track = stateRef.current.currentTrack;
      const csAudio = track?.csAudio || null;
      const needsSwap = csAudio && savedUrl && currentUrl !== savedUrl;
      void (async () => {
        if (needsSwap) {
          skipPauseInterruptionRef.current = true;
          audio.pause();
          await waitAudioSrcReady(audio, saved.src);
          const seekTo = saved.currentTime;
          const applySeek = () => {
            if (seekTo > 0 && isFinite(audio.duration)) {
              audio.currentTime = Math.min(seekTo, Math.max(0, audio.duration - 0.25));
            }
            audio.removeEventListener("loadedmetadata", applySeek);
          };
          audio.addEventListener("loadedmetadata", applySeek);
          if (isFinite(audio.duration) && audio.duration > 0) applySeek();
        } else if (saved.currentTime > 0) {
          audio.currentTime = saved.currentTime;
        }
        audio.playbackRate = saved.playbackRate ?? 1;
        if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
        if (saved.wasPlaying && audio.paused) {
          try {
            await audio.play();
          } catch (e) {
            if (e.name !== "AbortError") {
              console.error("[AUDIO]", e.name, e.message);
            }
          }
        }
      })();
    } else if (audio) {
      audio.playbackRate = 1;
      if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
    }

    csHoldActiveRef.current = false;
    csHoldSavedRef.current = null;
  }, []);

  const value = useMemo(() => ({
    ...state,
    playTrack,
    playQueue,
    setQueue,
    playNext,
    playPrevious,
    setRepeatMode,
    toggleRepeat,
    setShuffle,
    toggleShuffle,
    toggleCSMode,
    suppressPauseInterruptionRef: skipPauseInterruptionRef,
    pause,
    resume,
    toggle,
    seek,
    seekBack,
    seekForward,
    stop,
    audioRef,
    overrideConcurrentStream,
    dismissStreamConflict,
    retryStreamPlayback,
    storeLinkHref: STORE_LINK_HREF,
    beginCsHoldPreview,
    setCsHoldPlaybackRate,
    endCsHoldPreview,
    upgradeToFullStream,
    setOnPreviewEnded,
    previewEnded,
    setPreviewEnded,
    toggleSpaceMode,
    toggleBassBoost,
    cycleAtmosphere,
    getAnalyser: () => (webAudioAvailableRef.current ? analyserRef.current : null),
  }), [
    pause,
    playQueue,
    playTrack,
    playNext,
    playPrevious,
    resume,
    seek,
    seekBack,
    seekForward,
    setQueue,
    setRepeatMode,
    setShuffle,
    state,
    stop,
    toggle,
    toggleRepeat,
    toggleShuffle,
    toggleCSMode,
    overrideConcurrentStream,
    dismissStreamConflict,
    retryStreamPlayback,
    beginCsHoldPreview,
    setCsHoldPlaybackRate,
    endCsHoldPreview,
    upgradeToFullStream,
    setOnPreviewEnded,
    previewEnded,
    setPreviewEnded,
    toggleSpaceMode,
    toggleBassBoost,
    cycleAtmosphere,
  ]);

  useEffect(() => () => {
    stopProgressRaf();
    stopKeepAlivePing();
  }, [stopProgressRaf, stopKeepAlivePing]);

  return (
    <AudioContext.Provider value={value}>
      <AudioPhase10Bridge />
      {children}
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
        {...{ "webkit-playsinline": "", "x-webkit-airplay": "allow" }}
        style={{ display: "none" }}
      />
    </AudioContext.Provider>
  );
}

export function useAudioPlayer() {
  const value = useContext(AudioContext);
  if (!value) {
    throw new Error("useAudioPlayer must be used within AudioProvider");
  }
  return value;
}
