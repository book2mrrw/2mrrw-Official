# Playback State Propagation Audit (2026-05-28)

## Scope
- `PLAY_TRACK` -> state commit flow
- Player visibility conditions
- `AudioContext` -> `useMediaEngine` propagation
- `loading -> ready -> playing` visibility compatibility
- stale invalidation behavior
- diagnostics quality

## Top finding
Propagation does **not** stop at the media engine bridge; it stops at UI visibility gates because `hasStarted` can remain `false` while playback reaches `playing`.

## Exact break
In `src/context/AudioContext.js`, `playTrackInternal` always runs:
- `patchState({ ..., hasStarted: false, playbackState: "loading" })`

Then only the `!isSameTrack` branch sets:
- `patchState({ hasStarted: true, playbackState: "ready" })`

The `isSameTrack` branch can reach:
- `patchState({ isPlaying: true, error: null, playbackState: "playing" })`

without any `hasStarted: true` write.

Result: audio state can indicate active playback, but UI components gated on `hasStarted` never render.

## Explicit answers
1. **Exact point where propagation stops**  
   Visibility gating in consumers (`GlobalAudioPlayerBar` and `page.js` now-playing effect), not bridge dispatch.
2. **Whether `currentTrack` commits**  
   Yes. `currentTrack` is patched early in `playTrackInternal`.
3. **Whether player visibility state updates**  
   No in affected path, because `hasStarted` stays false.
4. **Whether UI mount conditions are wrong**  
   Conditions are internally consistent, but incompatible with same-track transition semantics.
5. **Whether `useMediaEngine` subscription chain broke**  
   No. Bridge registration + notify path appears intact.
6. **Whether stale invalidation suppresses commits**  
   Possible in edge races, but not the primary regression observed; primary is `hasStarted` lifecycle mismatch.
7. **Minimal remediation**  
   Ensure `hasStarted` is set true in all successful play paths (including `isSameTrack`).

