# Architecture Before vs After

## Before
- Playback mutators (`playTrack`, `playQueue`, `pause`, `resume`, `seek`, `next`, `prev`, `stop`) executed through separate callback paths.
- Media session and lifecycle handlers could invoke state-changing paths independently, increasing overlap/race risk.
- Playback-critical error handling included silent catches in key paths.

## After
- `dispatchPlaybackCommand` is the single orchestration gateway for playback commands.
- `executePlaybackCommand` is the central command transition map for playback actions.
- Commands include request IDs and command queue sequencing to invalidate stale async results.
- Media session and lifecycle recovery paths route through command orchestration.
- Playback-critical error paths emit structured diagnostics.
