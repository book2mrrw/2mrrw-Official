# Loading -> Ready -> Playing Flow Compatibility

## Intended path
- `loading` (track committed, source preparing)
- `ready` (source ready, `hasStarted: true`)
- `playing` (playback started)

## Actual compatibility issue
- `hasStarted` is reset to `false` at loading for every play request.
- `ready` with `hasStarted: true` is emitted only in `!isSameTrack`.
- `isSameTrack` can move directly to `playing` without restoring `hasStarted`.

## Compatibility impact
- UI assumes `hasStarted` is true once active playback is visible.
- Same-track path violates that assumption, creating hidden-but-playing state.

