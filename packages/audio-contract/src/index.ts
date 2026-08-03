// @2mrrw/audio-contract — playback interfaces ONLY. No implementation.
// Both apps/web (AudioContext.js) and apps/mobile (NativeAudioModule) implement these contracts.

export type FsmState =
  | 'IDLE'
  | 'LOADING'
  | 'PLAYING'
  | 'BUFFERING'
  | 'CROSSFADE'
  | 'PAUSED'
  | 'RECOVERING'
  | 'DEGRADED';

export type PlaybackEvent =
  | 'LOAD_START'
  | 'LOAD_END'
  | 'PLAY_SUCCESS'
  | 'PAUSE'
  | 'BUFFER_START'
  | 'BUFFER_END'
  | 'CROSSFADE_START'
  | 'CROSSFADE_END'
  | 'STOP'
  | 'RESET'
  | 'AUDIO_DESYNC_DETECTED'
  | 'RECOVERY_REQUESTED'
  | 'RECOVER_COMPLETE'
  | 'RECOVER_FAILED';

export type RepeatMode = 'none' | 'one' | 'all';

export interface PlayOptions {
  startAt?: number;
  previewOnly?: boolean;
  crossfade?: boolean;
}

export interface PlaybackCommand {
  play(track: unknown, queue: unknown[], startIndex: number, options?: PlayOptions): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  seekTo(seconds: number): void;
  skipNext(): void;
  skipPrevious(): void;
  setVolume(level: number): void;
  setRate(rate: number): void;
  setRepeatMode(mode: RepeatMode): void;
  setShuffle(enabled: boolean): void;
  setSleepTimer(endsAt: number | null): void;
  preloadNext(track: unknown): void;
  addToQueue(tracks: unknown[], at?: 'end' | 'next'): void;
  removeFromQueue(index: number): void;
  moveInQueue(from: number, to: number): void;
  clearQueue(): void;
}

export interface PlaybackError {
  code: string;
  message: string;
  track: unknown | null;
  recoverable: boolean;
}

export type Unsubscribe = () => void;

export interface PlaybackEventEmitter {
  onStateChange(listener: (state: Record<string, unknown>) => void): Unsubscribe;
  onProgress(listener: (time: number, duration: number) => void): Unsubscribe;
  onTrackEnd(listener: (track: unknown) => void): Unsubscribe;
  onTrackStart(listener: (track: unknown) => void): Unsubscribe;
  onError(listener: (error: PlaybackError) => void): Unsubscribe;
  onBufferingChange(listener: (buffering: boolean) => void): Unsubscribe;
  onPreviewEnded(listener: (track: unknown) => void): Unsubscribe;
}
