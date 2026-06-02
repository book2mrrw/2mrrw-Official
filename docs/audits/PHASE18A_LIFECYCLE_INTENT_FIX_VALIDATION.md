# Phase 18A — Lifecycle intent capture and Restored title guard

**Date:** 2026-06-01  
**Scope:** Background playback resume intent, lifecycle health gating, recovery title UX/trace (no PlaybackStateMachine rewrite, no `page.js` islands).

## Problem (from Phase 18 forensic audit)

1. OS/tab background often fires `pause` on the `<audio>` element before `visibilitychange` → `hidden`.
2. `onPause` cleared React `isPlaying` before hide, so `wasPlayingBeforeHideRef` captured `false`.
3. On return, `resumeAfter` was false and `evaluateLifecyclePlaybackHealth({ resumeAfter: false })` returned `transport_ok_paused` (healthy) → lifecycle recovery skipped while the element stayed paused.
4. Recovery hydration used placeholder title `"Restored"`, which surfaced in player chrome.

## Changes

### Part A — `AudioContext.js`

- Added `playbackIntentBeforeHideRef`.
- **`onPause`:** Before `patchState({ isPlaying: false })`, if `!userInitiated && !wasViewportPause && readIsAudiblyPlaying()`, set intent ref `true`. Clear on user pause.
- **`visibilitychange` → hidden:** `wasPlayingBeforeHideRef` = intent ref OR element still audibly playing (not React `isPlaying`).
- **`visibilitychange` → visible / `pageshow` (bfcache):** `resumeAfter` uses intent + `wasPlayingBeforeHideRef`; clear intent after read.

### Part B — `evaluateLifecyclePlaybackHealth`

- When `playbackIntentBeforeHideRef` is set and `audio.paused`, return `{ healthy: false, reason: "paused_after_lifecycle_interrupt" }` instead of `transport_ok_paused` skip (both `resumeAfter` false and true paths).

### Part C — `RESTORED_TITLE_SOURCE` trace

- `logRestoredTitleSource()` in `src/lib/diagnostics/playback-trace.js`.
- Emits `[playback-event] RESTORED_TITLE_SOURCE` when trace enabled (`NEXT_PUBLIC_PLAYBACK_TRACE=1` or development).
- Instrumented: `useTrackHydration.js`, `AudioPhase10Bridge.js`, `src/app/api/catalog/hydrate/route.js`.

### Part D — Player title guard

- `src/lib/playback/resolve-player-display-title.js` — `resolvePlayerDisplayTitle()` never returns `"Restored"`; falls back to slug.
- Applied: `GlobalAudioPlayerBar.js`, `StorefrontMiniPlayerBar.js`, `PlaybackChromeIsland.js` (nowPlaying snapshot).
- Buffering indicator unchanged (no title in buffer UI).

### Part E — `TRACK_SWITCH_AFTER_RETURN`

- `playTrack` logs `TRACK_SWITCH_AFTER_RETURN` when dispatched within 8s of last `visible` visibility change (trace gated).

## Manual validation

1. **Env:** `NEXT_PUBLIC_PLAYBACK_TRACE=1`, entitled track, real device or iOS Simulator Safari.
2. **Background interrupt:** Start full playback → lock screen or switch app 10s → return.
   - Expect: audio resumes or coalesced lifecycle recovery runs (not `LIFECYCLE_HEALTHY_SKIP_RECOVERY` with `transport_ok_paused` while element paused).
   - Console: no spurious healthy skip when intent was set.
3. **User pause:** Pause via UI → background → return. Expect: no auto-resume (`resumeAfter` false, intent cleared).
4. **Title:** Force recovery queue with unknown slug (hydrate miss). Player title shows slug, not `"Restored"`. Trace shows `RESTORED_TITLE_SOURCE` with source path.
5. **Track switch after return:** Tap different track within 8s of return. Console: `TRACK_SWITCH_AFTER_RETURN` with slug.

## Files touched

| File | Part |
|------|------|
| `src/context/AudioContext.js` | A, B, E |
| `src/lib/diagnostics/playback-trace.js` | C, E |
| `src/lib/playback/resolve-player-display-title.js` | D |
| `src/system/recovery/useTrackHydration.js` | C |
| `src/components/system/AudioPhase10Bridge.js` | C |
| `src/app/api/catalog/hydrate/route.js` | C |
| `src/components/audio/GlobalAudioPlayerBar.js` | D |
| `src/components/home/StorefrontMiniPlayerBar.js` | D |
| `src/components/storefront/PlaybackChromeIsland.js` | D |

## Build

```bash
npm run build
```

## Out of scope (unchanged)

- `PlaybackStateMachine` / `recoverAudioHard` naming
- `src/app/page.js` render islands
- Stripe / checkout
