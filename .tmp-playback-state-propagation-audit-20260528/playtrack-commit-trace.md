# PLAY_TRACK Commit Trace

## Command dispatch
- `dispatchPlaybackCommand(PLAY_TRACK, { track, options })` assigns command `requestId`.
- `executePlaybackCommand` routes to `playTrackInternal(track, options)`.

## Core state transitions in `playTrackInternal`
1. Request sequencing:
   - increments `playRequestIdRef`.
2. Normalization + source resolution:
   - prepares `nextTrack`, `syncSrc`.
3. **Early commit (always)**:
   - `patchState({ currentTrackId, currentTrack, hasStarted: false, playbackState: "loading", ... })`
4. Branch:
   - `!isSameTrack` path:
     - waits for source readiness
     - `patchState({ hasStarted: true, playbackState: "ready" })`
     - starts playback
   - `isSameTrack` path:
     - may skip reload and/or resume directly
     - no `hasStarted: true` patch
5. End commit:
   - `patchState({ isPlaying: true, error: null, playbackState: "playing" })`

## Failure mode observed
- Because step 3 always resets `hasStarted: false`, and step 4 only re-enables it in `!isSameTrack`, successful same-track play can end with:
  - `currentTrack` set
  - `playbackState: "playing"`
  - `isPlaying: true`
  - `hasStarted: false` (stale/incorrect for visibility)

