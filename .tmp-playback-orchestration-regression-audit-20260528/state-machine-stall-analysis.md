# State machine stall analysis

## Expected flow (requested)

`IDLE -> RESOLVING_ENTITLEMENT -> RESOLVING_STREAM -> VALIDATING_STREAM -> READY -> PLAYING`

## Actual post-refactor behavior

- Explicit orchestration states above are not represented in the current reducer patches.
- `playbackState` toggles among coarse values such as `playing`, `paused`, `preview_fallback`, `ending`, `idle` (or `null`).
- Critical start transition (`hasStarted: true`) is performed inside `playTrackInternal` at `src/context/AudioContext.js:1540-1551`.

## Stall point

- If command is dropped at `src/context/AudioContext.js:2137`, `playTrackInternal` never runs.
- Therefore all start transitions are skipped:
  - no `currentTrack` set
  - no `hasStarted: true`
  - no `playbackState: "playing"` (`1652`)

## Cancellation points inspected

- Command-level cancellation: `dispatchPlaybackCommand(..., { cancelActiveStream: true })` (`2213-2227`)
- Stream-level cancellation: `activeStreamAbortRef.current.abort()` (`1250-1254`, `2186-2188`)
- Neither is inherently fatal alone; stall is caused by stale command guard preempting command execution.
