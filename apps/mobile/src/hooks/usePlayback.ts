import { usePlaybackStore } from '@/stores/playback-store';
import type { Track } from '@2mrrw/types';

export function usePlayback() {
  const store = usePlaybackStore();

  const playRelease = (tracks: Track[], startIndex = 0) => {
    store.playQueue(tracks, startIndex);
  };

  const togglePlay = () => {
    if (store.isPlaying) {
      store.pause();
    } else {
      store.resume();
    }
  };

  return {
    currentTrack: store.currentTrack,
    isPlaying: store.isPlaying,
    isBuffering: store.isBuffering,
    currentTime: store.currentTime,
    duration: store.duration,
    queue: store.queue,
    queueIndex: store.queueIndex,
    repeatMode: store.repeatMode,
    shuffled: store.shuffled,
    playRelease,
    togglePlay,
    play: store.play,
    pause: store.pause,
    resume: store.resume,
    next: store.next,
    prev: store.prev,
    seek: store.seek,
    stop: store.stop,
    setRepeat: store.setRepeat,
    toggleShuffle: store.toggleShuffle,
  };
}
