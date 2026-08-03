/**
 * Playback store — single source of truth for all audio state on mobile.
 * Backed by react-native-track-player; updated by AudioEngine event handlers.
 */

import { create } from 'zustand';
import TrackPlayer from 'react-native-track-player';
import type { Track, RepeatMode } from '@2mrrw/types';
import { executeCommand } from '@/audio/AudioEngine';

interface PlaybackState {
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  repeat: RepeatMode;
  shuffle: boolean;
  error: string | null;

  // Actions — called by UI components
  play: (track: Track) => Promise<void>;
  playQueue: (tracks: Track[], startIndex?: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seek: (time: number) => Promise<void>;
  stop: () => Promise<void>;
  setRepeat: (mode: RepeatMode) => void;
  toggleShuffle: () => void;

  // Internal setters — called by AudioEngine
  setTrack: (track: Track) => void;
  setQueue: (tracks: Track[], index: number) => void;
  setPlaying: (playing: boolean) => void;
  setBuffering: (buffering: boolean) => void;
  setProgress: (currentTime: number, duration: number) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  currentTrack: null,
  queue: [],
  queueIndex: -1,
  isPlaying: false,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
  repeat: 'off',
  shuffle: false,
  error: null,

  play: async (track) => {
    set({ error: null });
    await executeCommand({ type: 'PLAY_TRACK', payload: { track } });
  },

  playQueue: async (tracks, startIndex = 0) => {
    set({ error: null });
    await executeCommand({ type: 'PLAY_QUEUE', payload: { tracks, startIndex } });
  },

  pause: async () => {
    await executeCommand({ type: 'PAUSE', payload: {} });
  },

  resume: async () => {
    await executeCommand({ type: 'RESUME', payload: {} });
  },

  next: async () => {
    await executeCommand({ type: 'NEXT_TRACK', payload: {} });
  },

  prev: async () => {
    await executeCommand({ type: 'PREV_TRACK', payload: {} });
  },

  seek: async (time) => {
    await executeCommand({ type: 'SEEK', payload: { time } });
  },

  stop: async () => {
    await executeCommand({ type: 'STOP', payload: {} });
  },

  setRepeat: (mode) => {
    executeCommand({ type: 'SET_REPEAT', payload: { mode } });
    set({ repeat: mode });
  },

  toggleShuffle: () => {
    set((s) => ({ shuffle: !s.shuffle }));
  },

  // Internal setters
  setTrack: (track) => set({ currentTrack: track, error: null }),
  setQueue: (tracks, index) => set({ queue: tracks, queueIndex: index }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setBuffering: (isBuffering) => set({ isBuffering }),
  setProgress: (currentTime, duration) => set({ currentTime, duration }),
  setError: (error) => set({ error, isPlaying: false }),
  reset: () =>
    set({
      currentTrack: null,
      queue: [],
      queueIndex: -1,
      isPlaying: false,
      isBuffering: false,
      currentTime: 0,
      duration: 0,
      error: null,
    }),
}));
