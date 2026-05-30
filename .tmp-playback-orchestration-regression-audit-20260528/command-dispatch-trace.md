# Command dispatch trace

## UI -> context dispatch path

1. Singles/features/albums UI calls:
   - `src/components/music/ReleaseCardPlayButton.js:58` -> `playQueue([track], 0)`
   - `src/app/page.js:1027` -> `playQueue(playable, queueIndex)`
   - `src/app/page.js:1032` / `1046` -> `playTrack(...)`
2. `AudioContext` wrappers dispatch through:
   - `src/context/AudioContext.js:2213-2227` (`playTrack`, `playQueue`)
3. Dispatcher queues command:
   - `src/context/AudioContext.js:2179-2211`
4. Command executes through:
   - `src/context/AudioContext.js:2136-2177` (`executePlaybackCommand`)
5. Intended terminal call:
   - `src/context/AudioContext.js:2140` -> `playTrackInternal(...)`
   - or `2142-2146` -> `playQueueInternal(...)` -> `1982-1986` -> `playTrackInternal(...)`

## Regression point in trace

- At `src/context/AudioContext.js:2137`, dispatcher rejects if `activeCommandRef` no longer matches this command request ID.
- Because `activeCommandRef` is shared mutable state and non-serial commands (`seek`) can run out-of-band, a valid queued `PLAY_*` command can be treated as stale.
- Result: dispatch promise resolves `false`; no playback init side effects.

## Queue/deadlock observations

- No hard deadlock loop found in queue chaining (`2208-2210` is structurally valid).
- Primary failure is over-aggressive stale invalidation, not unresolved queue promise creation.
