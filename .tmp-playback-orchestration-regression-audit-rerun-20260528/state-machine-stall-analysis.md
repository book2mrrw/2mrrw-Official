# State Machine Stall Analysis

## Observed state progression model
- Nominal transitions are implicit through `patchState`: `null`/setup -> `playing` -> `ending` -> `idle`.
- Preview path uses `preview_fallback` and `ended_preview`.
- Error path uses `paused` plus error message.

## Regression behavior
- In `playTrackInternal`, state is patched early with `hasStarted: true`, `currentTrack`, and `playbackState: null` before critical async load/play completion.
- If readiness await hangs, the progression to `playbackState: "playing"` or terminal error path does not happen.

## Stuck verdict
- **State machine stuck: YES (intermittent, in pre-playing limbo)**.
- Stuck signature: `hasStarted=true`, track selected, `playbackState=null`, `isPlaying` not advancing, queue commands blocked.

## File-level failure point
- `src/context/AudioContext.js`: `waitAudioSrcReady()` + `playTrackInternal()` async path without bounded completion.
