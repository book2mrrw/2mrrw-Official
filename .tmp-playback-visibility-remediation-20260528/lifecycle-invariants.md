# Playback Lifecycle Invariants

## Enforced invariant

- `playbackState === "playing"` must never coexist with `hasStarted === false`.

## Additional deterministic visibility guarantees

- Any state patch resolving to `playbackState === "ready"` sets `hasStarted` to `true`.
- Any state patch resolving to `isPlaying === true` sets `hasStarted` to `true`.
- Successful same-track replay/resume path explicitly normalizes to:
  - `isPlaying: true`
  - `playbackState: "playing"`
  - `hasStarted: true`
- Successful resume/interruption recovery explicitly normalizes to:
  - `isPlaying: true`
  - `playbackState: "playing"`
  - `hasStarted: true`
- Successful preview fallback / stream retry playback sets `hasStarted: true` when entering active playback.

## Diagnostic behavior

- If a state patch would produce `playing + hasStarted:false`, a structured warning is emitted through `reportPlaybackDiagnostic` with code:
  - `PLAYBACK_VISIBILITY_INVARIANT_RECOVERED`
