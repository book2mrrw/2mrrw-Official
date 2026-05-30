# Initialization Timing / Race Analysis

## Startup sequence
- `AudioProvider` mounts and renders `AudioPhase10Bridge`.
- `SessionRecoveryRoot` runs `useSessionRecovery()`, hydrates queue IDs, dispatches `2mrrw:playback-recovery` event.
- Bridge listener (`AudioPhase10Bridge`) handles event with `setQueue(...)` + optional `seek(...)`.

## Race findings
- Listener registration and recovery dispatch are both effect-driven; generally ordered, but still async and timing-sensitive under fast/failed fetch paths.
- Recovery dispatch can apply `seek()` before stable playback source is loaded; seek alone cannot progress state.
- Combined with serialized command stalling, startup recovery can appear frozen with restored queue but no actionable progress.

## Initialization race verdict
- **Initialization races exist: YES (timing-sensitive recovery/seek ordering)**.

## File-level points
- `src/components/system/AudioPhase10Bridge.js`
- `src/system/recovery/useSessionRecovery.js`
- `src/context/AudioContext.js` (seek + load orchestration interactions)
