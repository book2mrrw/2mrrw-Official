# Diagnostics Review

## Existing diagnostic coverage
- Command timeout / failure / stale cleanup
- stream event post failures
- reconnect and interruption contexts
- visibility state included in several failure payloads

## Gap relative to observed bug
- No explicit diagnostic for contradictory state such as:
  - `playbackState === "playing"` with `hasStarted === false`
  - `isPlaying === true` with hidden-player gate conditions failing

## Practical implication
- Logs can show command success while UI remains absent, without a direct signal that visibility preconditions are inconsistent.

## Suggested diagnostic additions (minimal)
- Warn when entering `"playing"` while `hasStarted` is false.
- Warn when `currentTrack` exists and playback is active but UI gate state remains false beyond a short threshold.

