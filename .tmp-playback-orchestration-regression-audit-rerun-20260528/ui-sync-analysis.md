# UI Sync Analysis

## Sync architecture
- Source of truth: `AudioProvider` state in `src/context/AudioContext.js`.
- Bridge propagation: `notifyMediaEngineBridge()` and `useMediaEngine()` subscription.
- UI consumers: `GlobalAudioPlayerBar`, immersive player components.

## Regression impact
- UI receives selected track and started state before playback successfully transitions.
- Under stalled command, controls render with track metadata but transport does not progress to playing/error terminal state quickly.
- User-facing result appears as UI/engine mismatch (selected track shown, no forward playback progression).

## Additional propagation risk
- `useMediaEngine` cache equality (`queueEqual`) compares queue entries by id/slug only; per-track field mutations can be hidden from subscription diff.

## UI sync verdict
- **UI sync broke: PARTIALLY YES**.
- Core issue is orchestration stall surfacing as stale/incomplete UI progression, not total render disconnect.

## File-level points
- `src/context/AudioContext.js` (premature state patch before guaranteed transition)
- `src/media/useMediaEngine.js` (coarse queue equality can suppress updates)
