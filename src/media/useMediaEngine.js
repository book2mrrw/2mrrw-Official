"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  useAudioPlayer,
  usePlaybackProgress,
  usePlaybackTransport,
} from "@/context/AudioContext";
import { getMediaEngineBridge, subscribeMediaEngine } from "@/media/mediaEngineBridge";

/**
 * Maps AudioContext track shape to subscription-layer track fields.
 */
export function mapContextTrackToMediaTrack(track) {
  if (!track) return null;
  return {
    id: track.id ?? track.slug ?? null,
    slug: track.slug ?? track.id ?? null,
    title: track.title ?? "Untitled",
    artist: track.artist ?? "2MRRW",
    artwork: track.cover ?? track.baseCover ?? null,
    audioUrl: track.src ?? track.baseSrc ?? null,
    metadata: track.metadata ?? null,
  };
}

/**
 * Maps subscription play() payload to AudioContext playTrack input.
 */
export function mapMediaTrackToPlayInput(track = {}) {
  const id = track.id ?? track.slug;
  const audioUrl = track.audioUrl ?? track.src ?? track.audio ?? track.url ?? "";
  return {
    id,
    slug: track.slug ?? id,
    src: audioUrl,
    audio: audioUrl,
    title: track.title,
    artist: track.artist,
    cover: track.artwork ?? track.cover,
    gainDb: track.gainDb ?? track.gain_db ?? null,
    metadata: track.metadata,
    source: track.source,
  };
}

const VOL_KEY = "2mrrw-vol";

function readVolume(audioRef) {
  const el = audioRef?.current;
  if (!el) return 1;
  if (el.volume > 0) return el.volume;
  // el.volume is 0 — report what volume should be without mutating here.
  // The audio engine owns el.volume; mutating it inside useMemo races against
  // the engine's own volume management (e.g. preview fades, swell ramps).
  let v = 1;
  try {
    const s = parseFloat(localStorage.getItem(VOL_KEY) ?? "");
    if (Number.isFinite(s) && s > 0) v = s;
  } catch {}
  return v;
}

function readElementPlaying(audioRef) {
  const el = audioRef?.current;
  return Boolean(el && !el.paused && !el.ended);
}

let _cachedMediaEngineState = null;

function tracksEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return (
    a.id === b.id &&
    a.slug === b.slug &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.artwork === b.artwork &&
    a.audioUrl === b.audioUrl
  );
}

function queueEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] || {};
    const bi = b[i] || {};
    const aid = ai.id ?? ai.slug;
    const bid = bi.id ?? bi.slug;
    if (aid !== bid) return false;
    if ((ai.slug ?? null) !== (bi.slug ?? null)) return false;
    if ((ai.src ?? ai.audioUrl ?? null) !== (bi.src ?? bi.audioUrl ?? null)) return false;
    if ((ai.source ?? null) !== (bi.source ?? null)) return false;
    if ((ai.title ?? null) !== (bi.title ?? null)) return false;
    if ((ai.artist ?? null) !== (bi.artist ?? null)) return false;
    const aAccess = ai.metadata?.access;
    const bAccess = bi.metadata?.access;
    if (Boolean(aAccess?.previewOnly) !== Boolean(bAccess?.previewOnly)) return false;
    if (Boolean(aAccess?.canStream) !== Boolean(bAccess?.canStream)) return false;
  }
  return true;
}

function mediaEngineStateChanged(next, prev) {
  if (prev === null) return true;
  if (next === null) return prev !== null;
  return (
    !tracksEqual(next.currentTrack, prev.currentTrack) ||
    next.isPlaying !== prev.isPlaying ||
    next.currentTime !== prev.currentTime ||
    next.duration !== prev.duration ||
    next.volume !== prev.volume ||
    !queueEqual(next.queue, prev.queue) ||
    next.queueIndex !== prev.queueIndex ||
    next.playbackState !== prev.playbackState ||
    next.csMode !== prev.csMode ||
    next.spaceMode !== prev.spaceMode ||
    next.bassMode !== prev.bassMode ||
    next.atmosphereLevel !== prev.atmosphereLevel ||
    next.shuffle !== prev.shuffle ||
    next.repeatMode !== prev.repeatMode ||
    next.sleepTimerEndsAt !== prev.sleepTimerEndsAt ||
    next.sleepAfterCurrentTrack !== prev.sleepAfterCurrentTrack
  );
}

function getMediaEngineSnapshot() {
  const next = getMediaEngineBridge()?.getState?.() ?? null;

  if (_cachedMediaEngineState === null || mediaEngineStateChanged(next, _cachedMediaEngineState)) {
    _cachedMediaEngineState = next;
  }

  return _cachedMediaEngineState;
}

/**
 * Pure mapper: AudioContext value → useMediaEngine public API.
 * Shared by the hook and imperative bridge snapshots.
 */
export function mapAudioContextToMediaEngine(audio) {
  const currentTrack = mapContextTrackToMediaTrack(audio.currentTrack);
  const bridge = getMediaEngineBridge();
  const audiblyPlaying = audio.getIsAudiblyPlaying?.();
  const bridgePlaying = bridge?.getState?.()?.isPlaying;
  const isPlaying =
    typeof audio.isPlaying === "boolean"
      ? audio.isPlaying
      : typeof audiblyPlaying === "boolean"
        ? audiblyPlaying
        : typeof bridgePlaying === "boolean"
          ? bridgePlaying
          : readElementPlaying(audio.audioRef);

  return {
    state: {
      currentTrack,
      isPlaying,
      currentTime: audio.getCurrentTime?.() ?? audio.currentTime ?? 0,
      duration: audio.duration ?? 0,
      volume: audio.getUserVolume?.() ?? readVolume(audio.audioRef),
      queue: audio.queue ?? [],
      queueIndex: audio.queueIndex ?? -1,
      playbackState: audio.playbackState ?? null,
      csMode: Boolean(audio.csMode),
      spaceMode: Boolean(audio.spaceMode),
      bassMode: Boolean(audio.bassMode),
      atmosphereLevel: audio.atmosphereLevel ?? 3,
      shuffle: Boolean(audio.shuffle),
      repeatMode: audio.repeatMode ?? "off",
      sleepTimerEndsAt: audio.sleepTimerEndsAt ?? null,
      sleepAfterCurrentTrack: Boolean(audio.sleepAfterCurrentTrack),
    },
    play: (track) => audio.playTrack(mapMediaTrackToPlayInput(track)),
    pause: audio.pause,
    seek: audio.seek,
    setVolume: (level) => {
      audio.setUserVolume?.(level);
    },
    toggle: audio.toggle,
    playNext: audio.playNext ?? null,
    playPrevious: audio.playPrevious ?? null,
    seekBack: audio.seekBack ?? null,
    seekForward: audio.seekForward ?? null,
    toggleShuffle: audio.toggleShuffle ?? null,
    toggleRepeat: audio.toggleRepeat ?? null,
    setSleepTimer: audio.setSleepTimer ?? null,
    enqueueTrack: audio.enqueueTrack ?? null,
    removeFromQueue: audio.removeFromQueue ?? null,
    moveInQueue: audio.moveInQueue ?? null,
    setPlaybackRate: (rate) => {
      const el = audio.audioRef?.current;
      if (el && Number.isFinite(rate) && rate > 0) {
        el.playbackRate = rate;
        if (typeof el.preservesPitch !== "undefined") el.preservesPitch = true;
      }
    },
    toggleCSMode: audio.toggleCSMode,
    toggleSpaceMode: audio.toggleSpaceMode,
    toggleBassBoost: audio.toggleBassBoost,
    cycleAtmosphere: audio.cycleAtmosphere,
    analyser: bridge?.getAnalyser?.() ?? audio.getAnalyser?.() ?? null,
  };
}

/**
 * React subscription layer over AudioContext (single `<audio>` engine).
 */
export function useMediaEngine() {
  const audio = useAudioPlayer();
  const progress = usePlaybackProgress();
  const transport = usePlaybackTransport();
  useSyncExternalStore(subscribeMediaEngine, getMediaEngineSnapshot, () => null);
  return useMemo(() => {
    const mapped = mapAudioContextToMediaEngine(audio);
    return {
      ...mapped,
      state: {
        ...mapped.state,
        currentTime: progress.currentTime,
        duration: progress.duration || mapped.state.duration,
        playbackNetworkState: transport.playbackNetworkState,
        isBuffering: transport.isBuffering,
      },
    };
  }, [
    audio,
    progress.currentTime,
    progress.duration,
    transport.playbackNetworkState,
    transport.isBuffering,
  ]);
}
