# React Audio Bridge Spec (Phase 10)

## AudioProvider responsibilities (unchanged behavior, thinner lifecycle)

1. **Subscribe** — `useState` / refs mirror playback for UI (`useAudioPlayer`, `usePlaybackProgress`).
2. **Forward** — Public APIs (`playTrack`, `pause`, `seek`, …) call `dispatchPlaybackCommand` (Phase 8).
3. **Sync** — Element event listeners patch React state; `registerMediaEngineBridge` reads `audioRef` + `stateRef`.
4. **Init once** — `useEffect([])` calls `noteAudioProviderMount`, `ensureDetachedAudioElement`, perf marks.

## Engine refs consumed by provider

From `getAudioEngineRefs()` (same object every render):

- `audioRef` — points at detached element after init
- `commandQueueRef`, `commandRequestIdRef`, `commandExecutionDepthRef`
- `activeCommandRef`, `queueCircuitOpenRef`, `queueWatchdogRef`, `activeStreamAbortRef`

## Stabilized against auth churn

| Before | After |
|--------|--------|
| `<audio ref={audioRef} />` inside provider tree | Element on `document.body`, survives provider re-render |
| Audio listener `useEffect` depended on `authLoading` | `authLoadingRef`; classification reads ref, effect deps trimmed |
| `entitlements:updated` listener re-bound when `authLoading` / `dispatch` changed | Empty deps; uses `authLoadingRef` + `dispatchPlaybackCommandRef` |

## Context export

`useAudioPlayer()` still exposes `audioRef` (engine singleton ref) for `useMediaEngine` volume reads.

## AudioPhase10Bridge

Unchanged role: queue preload, recovery, `dispatchPlaybackCommand("setQueue")` — stays outside bloated provider logic.
