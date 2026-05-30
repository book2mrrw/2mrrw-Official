# useMediaEngine Propagation Analysis

## Bridge chain
1. `AudioProvider` registers bridge via `registerMediaEngineBridge({ getState, getAnalyser })`.
2. On every `state` change, `AudioProvider` calls `notifyMediaEngineBridge()`.
3. `useMediaEngine()` subscribes with `useSyncExternalStore(subscribeMediaEngine, getMediaEngineSnapshot)`.

## Mapping behavior
- `mapAudioContextToMediaEngine` maps `audio.currentTrack` to `state.currentTrack`.
- Includes `isPlaying`, `currentTime`, `duration`, `playbackState`, etc.
- Does not include `hasStarted` in engine state (by design).

## Conclusion
- Subscription chain appears operational.
- No obvious break in bridge notify/subscribe plumbing.
- The observed invisibility is not due to engine subscription failure; it is due to downstream UI gates depending on `hasStarted` from `useAudioPlayer`.

