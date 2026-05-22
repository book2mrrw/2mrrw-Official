"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { sendControlSystemPlaybackEvent } from "@/lib/control-system/playback";
import {
  clearPersistedMediaSessionTrack,
  getArtworkEntriesForTrack,
  persistMediaSessionTrack,
  readPersistedMediaSessionTrack,
} from "@/lib/media-session-artwork";

const AudioContext = createContext(null);

const REPEAT_MODES = ["off", "all", "one"];
const POSITION_STATE_THROTTLE_MS = 1000;

const EMPTY_STATE = {
  currentTrackId: null,
  currentTrack: null,
  source: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  error: null,
  hasStarted: false,
  queue: [],
  queueIndex: -1,
  repeatMode: "off",
  shuffle: false,
};

const normalizeTrack = (track = {}) => {
  const src = track.src || track.preview || track.audio || track.url || "";
  const id = track.id || track.trackId || track.slug || src;
  return {
    id,
    slug: track.slug || id,
    title: track.title || "Untitled",
    artist: track.artist || "2MRRW",
    cover: track.cover || track.coverArt || track.image || null,
    src,
    source: track.source || "unknown",
    metadata: track.metadata || {},
  };
};

function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true
  );
}

export function AudioProvider({ children }) {
  const audioRef = useRef(null);
  const lastPersistRef = useRef({ key: null, at: 0 });
  const pendingSeekRef = useRef(null);
  const stateRef = useRef(EMPTY_STATE);
  const queueRef = useRef([]);
  const queueIndexRef = useRef(-1);
  const repeatModeRef = useRef("off");
  const shuffleRef = useRef(false);
  const playTrackRef = useRef(null);
  const userPausedRef = useRef(false);
  const skipPauseInterruptionRef = useRef(false);
  const lastPositionStateAtRef = useRef(0);
  const [state, setState] = useState(EMPTY_STATE);

  const patchState = useCallback((patch) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  const syncPositionState = useCallback((force = false) => {
    const audio = audioRef.current;
    if (
      typeof navigator === "undefined" ||
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
    if (typeof navigator === "undefined" || !navigator.mediaSession) return;
    const ms = navigator.mediaSession;
    if (!track) return;

    const artwork = await getArtworkEntriesForTrack(track.cover, track.slug);
    try {
      ms.metadata = new MediaMetadata({
        title: track.title || "Untitled",
        artist: track.artist || "2MRRW",
        album: track.source || "2MRRW",
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

  useEffect(() => {
    stateRef.current = state;
    queueRef.current = state.queue || [];
    queueIndexRef.current = state.queueIndex ?? -1;
    repeatModeRef.current = state.repeatMode || "off";
    shuffleRef.current = Boolean(state.shuffle);
  }, [state]);

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

    const onPlay = () => {
      userPausedRef.current = false;
      patchState({ isPlaying: true, error: null, hasStarted: true });
      persistPlayback("play");
      const track = stateRef.current.currentTrack;
      if (track) void updateMediaSession(track, { playing: true });
    };

    const onPause = () => {
      const userInitiated = userPausedRef.current;
      userPausedRef.current = false;

      if (skipPauseInterruptionRef.current) {
        skipPauseInterruptionRef.current = false;
        return;
      }

      patchState({ isPlaying: false });
      persistPlayback("pause");

      const track = stateRef.current.currentTrack;
      if (track) {
        void updateMediaSession(track, { playing: false });
      } else if (typeof navigator !== "undefined" && navigator.mediaSession) {
        navigator.mediaSession.playbackState = "paused";
      }

      if (!userInitiated && track && audio.paused) {
        /* External audio interruption — metadata retained, state paused */
      }
    };

    const onTime = () => {
      patchState({ currentTime: audio.currentTime || 0 });
      persistPlayback("progress");
      syncPositionState(false);
    };

    const onDuration = () => patchState({ duration: isFinite(audio.duration) ? audio.duration : 0 });
    const onEnded = () => {
      persistPlayback("complete");
      const repeatMode = repeatModeRef.current;
      const queue = queueRef.current;
      const queueIndex = queueIndexRef.current;

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
            patchState({ isPlaying: false, currentTime: 0 });
            const track = stateRef.current.currentTrack;
            if (track) void updateMediaSession(track, { playing: false });
            return;
          }
        }
        const nextTrack = queue[nextIndex];
        if (nextTrack) {
          queueIndexRef.current = nextIndex;
          patchState({ queueIndex: nextIndex });
          playTrackRef.current?.(nextTrack, { resumeAt: 0 });
          return;
        }
      }

      patchState({ isPlaying: false, currentTime: 0 });
      const track = stateRef.current.currentTrack;
      if (track) void updateMediaSession(track, { playing: false });
    };
    const onError = () => patchState({
      isPlaying: false,
      error: "Audio unavailable. Try again in a moment.",
    });
    const onEmptied = () => patchState({ currentTime: 0, duration: 0 });

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("emptied", onEmptied);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("emptied", onEmptied);
    };
  }, [patchState, updateMediaSession, syncPositionState]);

  const playTrack = useCallback(async (track, options = {}) => {
    const nextTrack = normalizeTrack(track);
    const audio = audioRef.current;
    if (!audio || !nextTrack.src) {
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

    const currentSrc = audio.currentSrc || audio.src;
    const nextUrl = new URL(nextTrack.src, window.location.href).href;
    const isSameTrack = stateRef.current.currentTrackId === nextTrack.id && currentSrc === nextUrl;
    const isReplay = isSameTrack && audio.ended;

    patchState({
      currentTrackId: nextTrack.id,
      currentTrack: nextTrack,
      source: nextTrack.source,
      error: null,
      hasStarted: true,
    });

    try {
      if (!isSameTrack) {
        skipPauseInterruptionRef.current = true;
        audio.pause();
        audio.src = nextTrack.src;
        audio.load();
        pendingSeekRef.current = options.resumeAt && options.resumeAt > 5 ? options.resumeAt : null;
      } else if (options.resumeAt && options.resumeAt > 5 && Math.abs(audio.currentTime - options.resumeAt) > 2) {
        audio.currentTime = options.resumeAt;
      }

      if (pendingSeekRef.current) {
        const applyPendingSeek = () => {
          if (pendingSeekRef.current && isFinite(audio.duration)) {
            audio.currentTime = Math.min(pendingSeekRef.current, Math.max(0, audio.duration - 1));
          }
          pendingSeekRef.current = null;
          audio.removeEventListener("loadedmetadata", applyPendingSeek);
        };
        audio.addEventListener("loadedmetadata", applyPendingSeek);
      }

      await audio.play();
      void updateMediaSession(nextTrack, { playing: true });

      if (isReplay) {
        sendControlSystemPlaybackEvent(nextTrack, "replay", {
          mediaType: "audio",
          positionSeconds: 0,
          durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
        });
      }
      patchState({ isPlaying: true, error: null });
      return true;
    } catch {
      patchState({ isPlaying: false, error: "Audio playback failed. Try again in a moment." });
      void updateMediaSession(nextTrack, { playing: false });
      return false;
    }
  }, [patchState, updateMediaSession]);

  useEffect(() => {
    playTrackRef.current = playTrack;
  });

  const setQueue = useCallback((tracks = [], startIndex = 0) => {
    const normalized = (tracks || []).map(normalizeTrack).filter((t) => t.src);
    const index = Math.max(0, Math.min(startIndex, normalized.length - 1));
    queueRef.current = normalized;
    queueIndexRef.current = normalized.length ? index : -1;
    patchState({ queue: normalized, queueIndex: queueIndexRef.current });
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
    return playTrack(queue[nextIndex], { resumeAt: 0 });
  }, [playTrack, patchState]);

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
    return playTrack(queue[prevIndex], { resumeAt: 0 });
  }, [playTrack, patchState, syncPositionState]);

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
    try {
      userPausedRef.current = false;
      await audioRef.current?.play();
      const track = stateRef.current.currentTrack;
      if (track) void updateMediaSession(track, { playing: true });
      patchState({ isPlaying: true, error: null });
      return true;
    } catch {
      patchState({ isPlaying: false, error: "Audio playback failed. Try again in a moment." });
      return false;
    }
  }, [patchState, updateMediaSession]);

  const toggle = useCallback(() => {
    if (audioRef.current?.paused) return resume();
    pause();
    return false;
  }, [pause, resume]);

  const seek = useCallback((time) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    audio.currentTime = Math.max(0, Math.min(time, isFinite(audio.duration) ? audio.duration : time));
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

  const stop = useCallback(() => {
    userPausedRef.current = true;
    const audio = audioRef.current;
    if (audio) {
      skipPauseInterruptionRef.current = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setState(EMPTY_STATE);
    queueRef.current = [];
    queueIndexRef.current = -1;
    clearPersistedMediaSessionTrack();
    if (typeof navigator !== "undefined" && navigator.mediaSession) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaSession) return undefined;
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
      } catch {
        /* ignore */
      }
    };
  }, [pause, resume, playNext, playPrevious, seek]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        rehydrateMediaSession();
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

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [rehydrateMediaSession]);

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
    pause,
    resume,
    toggle,
    seek,
    stop,
    audioRef,
  }), [
    pause,
    playQueue,
    playTrack,
    playNext,
    playPrevious,
    resume,
    seek,
    setQueue,
    setRepeatMode,
    setShuffle,
    state,
    stop,
    toggle,
    toggleRepeat,
    toggleShuffle,
  ]);

  return (
    <AudioContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        playsInline
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
