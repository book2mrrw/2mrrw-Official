"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
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
    coverArt: track.artwork ?? track.cover,
    image: track.artwork ?? track.cover,
    metadata: track.metadata,
    source: track.source,
  };
}

function readVolume(audioRef) {
  const el = audioRef?.current;
  if (el && typeof el.volume === "number") return el.volume;
  return 1;
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
    const aid = a[i]?.id ?? a[i]?.slug;
    const bid = b[i]?.id ?? b[i]?.slug;
    if (aid !== bid) return false;
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
    next.playbackState !== prev.playbackState ||
    next.csMode !== prev.csMode ||
    next.spaceMode !== prev.spaceMode ||
    next.bassMode !== prev.bassMode ||
    next.atmosphereLevel !== prev.atmosphereLevel
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

  return {
    state: {
      currentTrack,
      isPlaying: Boolean(audio.isPlaying),
      currentTime: audio.currentTime ?? 0,
      duration: audio.duration ?? 0,
      volume: readVolume(audio.audioRef),
      queue: audio.queue ?? [],
      playbackState: audio.playbackState ?? null,
      csMode: Boolean(audio.csMode),
      spaceMode: Boolean(audio.spaceMode),
      bassMode: Boolean(audio.bassMode),
      atmosphereLevel: audio.atmosphereLevel ?? 3,
    },
    play: (track) => audio.playTrack(mapMediaTrackToPlayInput(track)),
    pause: audio.pause,
    seek: audio.seek,
    setVolume: (level) => {
      const el = audio.audioRef?.current;
      if (!el) return;
      const v = Math.max(0, Math.min(1, Number(level)));
      if (Number.isFinite(v)) el.volume = v;
    },
    toggle: audio.toggle,
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
  useSyncExternalStore(subscribeMediaEngine, getMediaEngineSnapshot, () => null);
  return useMemo(() => mapAudioContextToMediaEngine(audio), [audio]);
}
