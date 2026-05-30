# Command Dispatch Trace

## Entry points
- Public commands route through `dispatchPlaybackCommand()` in `src/context/AudioContext.js`.
- Default mode is serialized (`serial: true`) for `PLAY_TRACK`, `PLAY_QUEUE`, `PAUSE`, `RESUME`, `NEXT_TRACK`, `PREV_TRACK`, `STOP`.
- `SEEK` is explicitly non-serial (`serial: false`).

## Dispatch pipeline
1. `dispatchPlaybackCommand(type, payload, opts)` increments `commandRequestIdRef`.
2. For serial commands, work is chained onto `commandQueueRef.current = commandQueueRef.current.catch(...).then(run)`.
3. `run()` sets `activeCommandRef.current` and executes `executePlaybackCommand(command)`.
4. `executePlaybackCommand()` gates on `command.requestId === activeCommandRef.current?.requestId`.
5. Transport functions eventually call `playTrackInternal`, `playQueueInternal`, `resumeInternal`, etc.

## Regression finding
- `playTrackInternal()` can await `loadAudioSrcAndPlay()` -> `waitAudioSrcReady()` with no timeout and no abort wiring on the readiness promise.
- When this pending await never settles (no `canplay`, `loadedmetadata`, or `error`), the serial queue does not advance.
- Result: subsequent serialized commands are blocked behind a stuck promise chain.

## Command queue deadlock verdict
- **Exists: YES (practical deadlock / starvation)**.
- Scope: serial queue stalls while a command promise remains unresolved; non-serial `SEEK` can still run but does not unstick queue.
