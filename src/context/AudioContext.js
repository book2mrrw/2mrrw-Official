"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { sendControlSystemPlaybackEvent } from "@/lib/control-system/playback";

const AudioContext = createContext(null);

const EMPTY_STATE = {
  currentTrackId: null,
  currentTrack: null,
  source: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  error: null,
  hasStarted: false,
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

export function AudioProvider({ children }) {
  const audioRef = useRef(null);
  const lastPersistRef = useRef({ key: null, at: 0 });
  const pendingSeekRef = useRef(null);
  const stateRef = useRef(EMPTY_STATE);
  const [state, setState] = useState(EMPTY_STATE);

  const patchState = useCallback((patch) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    stateRef.current = state;
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
      patchState({ isPlaying: true, error: null, hasStarted: true });
      persistPlayback("play");
    };
    const onPause = () => {
      patchState({ isPlaying: false });
      persistPlayback("pause");
    };
    const onTime = () => {
      patchState({ currentTime: audio.currentTime || 0 });
      persistPlayback("progress");
    };
    const onDuration = () => patchState({ duration: isFinite(audio.duration) ? audio.duration : 0 });
    const onEnded = () => {
      patchState({ isPlaying: false, currentTime: 0 });
      persistPlayback("complete");
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
  }, [patchState]);

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
      return false;
    }
  }, [patchState]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(async () => {
    try {
      await audioRef.current?.play();
      patchState({ isPlaying: true, error: null });
      return true;
    } catch {
      patchState({ isPlaying: false, error: "Audio playback failed. Try again in a moment." });
      return false;
    }
  }, [patchState]);

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
    if (stateRef.current.currentTrack) {
      sendControlSystemPlaybackEvent(stateRef.current.currentTrack, "seek", {
        mediaType: "audio",
        positionSeconds: audio.currentTime,
        durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
      });
    }
  }, [patchState]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setState(EMPTY_STATE);
  }, []);

  const value = useMemo(() => ({
    ...state,
    playTrack,
    pause,
    resume,
    toggle,
    seek,
    stop,
    audioRef,
  }), [pause, playTrack, resume, seek, state, stop, toggle]);

  return (
    <AudioContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="metadata" style={{ display: "none" }} />
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
