/**
 * Native audio engine — implements @2mrrw/audio-contract on top of
 * react-native-track-player (AVFoundation on iOS, Media3/ExoPlayer on Android).
 *
 * This is the single source of audio truth on mobile.
 * AudioContext.js (web) is never imported here.
 */

import TrackPlayer, {
  Capability,
  Event,
  RepeatMode as RNRepeatMode,
  State,
  usePlaybackState,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player';
import type {
  PlaybackCommand,
  PlaybackState,
  PlaybackEventEmitter,
  RepeatMode,
} from '@2mrrw/audio-contract';
import type { Track } from '@2mrrw/types';
import { usePlaybackStore } from '@/stores/playback-store';

// ─── Setup ────────────────────────────────────────────────────────────────────

export async function setupAudioEngine(): Promise<void> {
  await TrackPlayer.setupPlayer({
    maxCacheSize: 1024 * 50, // 50 MB
  });

  await TrackPlayer.updateOptions({
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
    ],
    compactCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
    ],
    notificationCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ],
    android: {
      appKilledPlaybackBehavior: 1, // StopPlaybackAndRemoveNotification
    },
  });
}

// ─── Track conversion ─────────────────────────────────────────────────────────

function toRNTPTrack(track: Track) {
  return {
    id: track.id,
    url: track.src,
    title: track.title,
    artist: track.artist,
    artwork: track.cover ?? undefined,
    duration: undefined, // resolved from stream
  };
}

// ─── Command implementations ──────────────────────────────────────────────────

export async function executeCommand(command: PlaybackCommand): Promise<boolean> {
  const store = usePlaybackStore.getState();

  switch (command.type) {
    case 'PLAY_TRACK': {
      const track = command.payload?.track as Track | undefined;
      if (!track) return false;
      await TrackPlayer.reset();
      await TrackPlayer.add(toRNTPTrack(track));
      await TrackPlayer.play();
      store.setTrack(track);
      store.setPlaying(true);
      return true;
    }

    case 'PLAY_QUEUE': {
      const tracks = (command.payload?.tracks as Track[]) ?? [];
      const startIndex = (command.payload?.startIndex as number) ?? 0;
      if (!tracks.length) return false;
      await TrackPlayer.reset();
      await TrackPlayer.add(tracks.map(toRNTPTrack));
      await TrackPlayer.skip(startIndex);
      await TrackPlayer.play();
      store.setQueue(tracks, startIndex);
      store.setPlaying(true);
      return true;
    }

    case 'PAUSE': {
      await TrackPlayer.pause();
      store.setPlaying(false);
      return true;
    }

    case 'RESUME': {
      await TrackPlayer.play();
      store.setPlaying(true);
      return true;
    }

    case 'NEXT_TRACK': {
      await TrackPlayer.skipToNext();
      return true;
    }

    case 'PREV_TRACK': {
      await TrackPlayer.skipToPrevious();
      return true;
    }

    case 'SEEK': {
      const time = command.payload?.time as number;
      if (typeof time !== 'number') return false;
      await TrackPlayer.seekTo(time);
      return true;
    }

    case 'STOP': {
      await TrackPlayer.reset();
      store.reset();
      return true;
    }

    case 'SET_REPEAT': {
      const mode = command.payload?.mode as RepeatMode;
      const rnMode =
        mode === 'one'
          ? RNRepeatMode.Track
          : mode === 'all'
          ? RNRepeatMode.Queue
          : RNRepeatMode.Off;
      await TrackPlayer.setRepeatMode(rnMode);
      store.setRepeat(mode);
      return true;
    }

    default:
      return false;
  }
}

// ─── Playback service (background task) ───────────────────────────────────────

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
    usePlaybackStore.getState().setPlaying(false);
  });

  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
    usePlaybackStore.getState().setPlaying(true);
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    TrackPlayer.skipToNext();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    TrackPlayer.skipToPrevious();
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position);
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
    if (event.track) {
      const store = usePlaybackStore.getState();
      // Sync track metadata from queue to store
      const queue = await TrackPlayer.getQueue();
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      if (activeIndex != null && queue[activeIndex]) {
        const rntpTrack = queue[activeIndex];
        // Build a minimal Track shape from RNTP track data
        store.setTrack({
          id: String(rntpTrack.id ?? ''),
          slug: String(rntpTrack.id ?? ''),
          title: rntpTrack.title ?? '',
          artist: rntpTrack.artist ?? '2MRRW',
          cover: rntpTrack.artwork ? String(rntpTrack.artwork) : null,
          baseCover: rntpTrack.artwork ? String(rntpTrack.artwork) : null,
          src: String(rntpTrack.url),
          baseSrc: String(rntpTrack.url),
          coverArtType: 'image',
          csAudio: null,
          csCover: null,
          csCoverType: 'image',
          hasCs: false,
          gainDb: null,
          source: 'queue',
          metadata: {},
          preview: null,
        });
      }
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
    const store = usePlaybackStore.getState();
    const playing = event.state === State.Playing;
    const buffering =
      event.state === State.Buffering || event.state === State.Loading;
    store.setPlaying(playing);
    store.setBuffering(buffering);
  });

  TrackPlayer.addEventListener(Event.PlaybackError, (error) => {
    usePlaybackStore.getState().setError(error.message ?? 'Playback error');
  });
}
