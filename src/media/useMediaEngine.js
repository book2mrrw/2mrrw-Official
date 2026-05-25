"use client";

import { useMemo } from "react";
import { useAudioPlayer } from "@/context/AudioContext";

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

/**
 * Pure mapper: AudioContext value → useMediaEngine public API.
 * Shared by the hook and imperative bridge snapshots.
 */
export function mapAudioContextToMediaEngine(audio) {
  const currentTrack = mapContextTrackToMediaTrack(audio.currentTrack);

  return {
    state: {
      currentTrack,
      isPlaying: Boolean(audio.isPlaying),
      currentTime: audio.currentTime ?? 0,
      duration: audio.duration ?? 0,
      volume: readVolume(audio.audioRef),
      queue: audio.queue ?? [],
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
  };
}

/**
 * React subscription layer over AudioContext (single `<audio>` engine).
 */
export function useMediaEngine() {
  const audio = useAudioPlayer();
  return useMemo(() => mapAudioContextToMediaEngine(audio), [audio]);
}
