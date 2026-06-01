# Phase 8 — Audio Playback Authority Lock

**Repo:** `/Users/recharge/artist-platform`  
**HEAD at implementation:** `34df134` (post Phase 7 audit)  
**Date:** 2026-06-01  

## Summary

Phase 8 hardens the existing **serial playback command queue** (`dispatchPlaybackCommand`) as the single mutation authority. No playback timing, entitlement resolution, viewport policy (6B), or stream-fallback logic was changed—only routing, trace violations, and soft migration of a few call sites.

## `dispatchPlaybackCommand` — pre-existing (Phase 4+)

`dispatchPlaybackCommand` **already existed** at `src/context/AudioContext.js` with `commandQueueRef` serialization, watchdog timeout, and emergency bypass for `PAUSE` / `STOP`.

### Extended command surface

| Alias / command | Constant | Executor |
|-----------------|----------|----------|
| `play` | `PLAY_TRACK` | `playTrackInternal` |
| `pause` | `PAUSE` | `pauseInternal({ userInitiated: true })` |
| `resume` | `RESUME` | `resumeInternal` |
| `stop` | `STOP` | `stopInternal` |
| `seek` | `SEEK` | `seekInternal` |
| `setQueue` | `SET_QUEUE` | `setQueueInternal` |
| `replaceTrack` | `REPLACE_TRACK` | `playTrackInternal` |
| `upgradeStream` | `UPGRADE_STREAM` | `upgradeToFullStream` |
| `recoverPlayback` | `RECOVER_PLAYBACK` | `retryStreamPlayback` |
| — | `VIEWPORT_PAUSE` | `pauseInternal({ fromViewport: true })` |
| — | `VIEWPORT_RESUME` | `resumeFromViewport` |
| — | `RECOVER` | `resumeInternal` (visibility) |
| — | `PLAY_QUEUE` | `playQueueInternal` |

Public hooks (`playTrack`, `pause`, `resume`, `seek`, `playQueue`, `stop`) continue to call `dispatchPlaybackCommand`. **`setQueue`** now routes through `SET_QUEUE` instead of calling `setQueueInternal` directly.

### Authority depth

`commandExecutionDepthRef` increments inside the command `run()` so internal functions invoked from `executePlaybackCommand` do not emit auth violations.

## Violation logging (TASK 2)

When `NEXT_PUBLIC_PLAYBACK_TRACE=1` (or dev default per `isPlaybackTraceEnabled()`):

- `[PLAYBACK-AUTH-VIOLATION]` is logged via `logPlaybackAuthViolation` in `src/lib/diagnostics/playback-trace.js`
- Triggered at the start of `pauseInternal`, `resumeInternal`, `seekInternal`, `setQueueInternal`, `playQueueInternal` when **not** inside an active command (`commandExecutionDepthRef === 0`)
- **Does not block** execution

## Soft migration (TASK 3)

| Site | Change |
|------|--------|
| `AudioPhase10Bridge.js` | `dispatchPlaybackCommand("setQueue", { tracks, startIndex })` |
| `AudioContext` `entitlements:updated` | `dispatchPlaybackCommand(UPGRADE_STREAM)` |
| `exitAudioVisualViewport` | `dispatchPlaybackCommand(VIEWPORT_RESUME)` (Phase 7 race mitigation) |
| `pauseForViewport` | `dispatchPlaybackCommand(VIEWPORT_PAUSE, {}, { serial: false })` |
| Public `setQueue` | Routes through `SET_QUEUE` command |

**Not migrated (intentional):** `page.js` monolith, `ReleaseCardPlayButton` direct `upgradeToFullStream()` — violations visible under trace only.

## Export

`dispatchPlaybackCommand` is exposed on `useAudioPlayer()` for controlled internal bridges.
