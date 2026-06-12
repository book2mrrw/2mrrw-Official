# Phase 21B — Lifecycle audio truth model enforcement

**Date:** 2026-06-02  
**Baseline:** Phase 21A (`a90f2c7`)  
**Mode:** Implementation (recovery gating + classification, not audit)

## Goal

Align watchdog, recovery, UI desync classification, Media Session sync, and orchestration machine to the A–D lifecycle truth model so **OS_SUSPENDED (C)** is never treated as playback failure.

| Class | Code | Recovery |
|-------|------|----------|
| A | `USER_PLAYING` | Normal playback |
| B | `USER_PAUSED` | No recovery |
| C | `OS_SUSPENDED` | **Hard block** — no watchdog desync, no hard recover, no FATAL desync, MS state preserved |
| D | `RECOVERING` | Hard/coalesced recovery allowed |

## Implementation summary

### `src/context/AudioContext.js`

- **`computeLifecycleAudioTruthState()`** — computed before watchdog, `evaluateLifecyclePlaybackHealth`, `patchState` desync, `requestPlaybackRecovery`, `runCoalescedLifecycleRecovery`, and `updateMediaSession`.
- **`isLifecycleOsSuspended()` / `blockRecoveryForLifecycleOsSuspended()`** — central gate for class C.
- **Watchdog** — skips entire interval when truth is `OS_SUSPENDED` (`WATCHDOG_SKIPPED_OS_SUSPEND`).
- **`patchState`** — skips `FATAL_AUDIO_DESYNC` + machine desync when class C.
- **`evaluateLifecyclePlaybackHealth`** — returns `{ reason: "os_suspended_ignored", osSuspended: true }` when class C.
- **`requestPlaybackRecovery` / `runCoalescedLifecycleRecovery` / `recoverAudioHard`** — early no-op when class C (non-transport reasons).
- **`updateMediaSession`** — when class C, does not override `navigator.mediaSession.playbackState` from element; uses `lastMediaSessionPlaybackStateRef` (set on lock-screen preserve / `onPlay`).
- Phase 21A trace hooks preserved; 20C suppression paths unchanged.

### `src/media/PlaybackStateMachine.js`

- **`setLifecycleRecoveryGuard()`** — blocks `AUDIO_DESYNC_DETECTED` / `RECOVERY_REQUESTED` → `_beginRecovery` when AudioContext reports class C.

### `src/lib/diagnostics/playback-trace.js`

Gated traces (`NEXT_PUBLIC_PLAYBACK_TRACE=1`):

- `LIFECYCLE_TRUTH_STATE_COMPUTED`
- `LIFECYCLE_STATE_C_SUPPRESSED`
- `WATCHDOG_SKIPPED_OS_SUSPEND`
- `RECOVERY_BLOCKED_LIFECYCLE_C`

Phase 19/20C/21A events unchanged (`LIFECYCLE_AUDIO_STATE_TRANSITION`, `OS_SUSPEND_DETECTED`, `RECOVERY_CLASSIFICATION_REASON`, etc.).

## Classification logic (summary)

1. **B** — `userPausedRef`
2. **D** — transport not intact, or active hard recovery / machine `RECOVERING`
3. **C** — `playbackIntentBeforeHideRef`, transport intact, background/hidden or OS-paused + suspended ctx
4. **A** — element playing in foreground, or audible while UI playing
5. Default **B**

## Behavioral matrix

| Scenario | Class | Recovery |
|----------|-------|----------|
| Lock while playing | C | No-op |
| Unlock with intent | C→A via lightweight only | Existing visibility path |
| User pause | B | No-op |
| Real stream failure | D | Hard allowed |
| Suspended AudioContext in C | C | Not failure |

## Validation

```bash
npm run build
npm run check:frontend-guardrails
```

## Untouched (per scope)

Web Audio routing, iOS background architecture, `page.js`, catalog/hydration, render 20F–20H.
