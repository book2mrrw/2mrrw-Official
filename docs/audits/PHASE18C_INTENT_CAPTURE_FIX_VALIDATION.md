# Phase 18C — Lifecycle intent capture and retry path (E1/E2)

**Date:** 2026-06-01  
**Baseline:** `78e2e19`  
**Scope:** `AudioContext.js` (+ `playback-trace.js` trace helpers only). No PlaybackStateMachine, `page.js`, or player chrome changes.

## Problem (Phase 18B forensic)

Phase 18A used `readIsAudiblyPlaying()` on `onPause` to set `playbackIntentBeforeHideRef`. OS/tab background often pauses the element **before** audibility samples reflect playback, so intent was not captured, `wasPlayingBeforeHide` was false on return, and `evaluateLifecyclePlaybackHealth({ resumeAfter: false })` returned `transport_ok_paused` while the element stayed paused.

The `canplay` interruption retry gated on `stateRef.current.isPlaying`, which `patchState` had already cleared.

## Fixes

### FIX 1 — `onPause` intent (before `patchState`)

Capture from React authority, not audibility:

```text
wasPlayingBeforePause =
  stateRef.isPlaying && stateRef.hasStarted && !userInitiated && !wasViewportPause
```

Set `playbackIntentBeforeHideRef` when true. Do **not** use `readIsAudiblyPlaying()` for this capture.

### FIX 2 — `canplay` retry gate

Retry when `wasPlayingBeforePause || playbackIntentBeforeHideRef` (closure + ref), not `stateRef.isPlaying` after pause patch.

### FIX 3 — Trace events (when trace enabled)

- `PLAYBACK_INTENT_CAPTURED` — `logPlaybackIntentCaptured()` on intent set in `onPause`
- `PLAYBACK_INTENT_RETRY` — `logPlaybackIntentRetry()` when `canplay` retry runs

### FIX 4 — Visible return / health gating

- Defer clearing `playbackIntentBeforeHideRef` until **after** `evaluateLifecyclePlaybackHealth` on visibility return and bfcache `pageshow`.
- Pass `lifecycleIntent: wasPlayingBeforeHide` (or `wasPlaying` for bfcache) so `transport_ok_paused` cannot mark healthy when interrupt intent exists, element is paused, and recovery should run.
- Bfcache `resumeAfter` aligned with visibility: intent + entitled + `!userPausedRef`.

## Manual validation

1. `NEXT_PUBLIC_PLAYBACK_TRACE=1`, entitled track, iOS Safari or Simulator.
2. Start playback → lock screen / switch app ~10s → return.
   - Expect: resume or coalesced lifecycle recovery (not `LIFECYCLE_HEALTHY_SKIP_RECOVERY` + `transport_ok_paused` with paused element and prior intent).
   - Console: `PLAYBACK_INTENT_CAPTURED` on background pause; optional `PLAYBACK_INTENT_RETRY` if stream reloads.
3. User pause via UI → background → return. Expect: no auto-resume; no `PLAYBACK_INTENT_CAPTURED` on user pause.
4. Viewport pause (scroll away from audio visuals): intent not captured; no spurious resume.

## Files

| File | Change |
|------|--------|
| `src/context/AudioContext.js` | FIX 1–4 |
| `src/lib/diagnostics/playback-trace.js` | FIX 3 helpers |
| `docs/audits/PHASE18C_INTENT_CAPTURE_FIX_VALIDATION.md` | This doc |

## Verification commands

```bash
npm run build
npm run check:frontend-guardrails
```
