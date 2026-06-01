# Direct Call Violation Report — Phase 8

**Scan scope:** `src/` excluding `AudioContext.js` internals  
**Violation signal:** `[PLAYBACK-AUTH-VIOLATION]` when trace enabled and `*Internal` reached without command depth  

## Confirmed external / out-of-band callers (grep)

| File | Symbol | Risk | Phase 8 action |
|------|--------|------|----------------|
| `src/components/system/AudioPhase10Bridge.js` | `setQueue` | Recovery queue race vs active session | **Migrated** → `dispatchPlaybackCommand("setQueue")` |
| `src/components/music/ReleaseCardPlayButton.js` | `upgradeToFullStream()` | Preview→full outside queue | **Not migrated** — trace will flag if internal path invoked without dispatch |
| `src/context/AudioContext.js` | `entitlements:updated` → `upgradeToFullStream()` | Stream swap during preview play | **Migrated** → `UPGRADE_STREAM` command |
| `src/app/page.js` | `playQueue`, `pause`, `resume`, etc. | Uses public API (already queued) | OK |
| `src/components/music/*` | `playQueue`, `playTrack` | Public API | OK |

## Internal paths still allowed (no violation when trace on)

| Path | Reason |
|------|--------|
| `executePlaybackCommand` → `*Internal` | `commandExecutionDepthRef > 0` |
| `resumeFromViewport` → `resumeTrackAtPosition` → `resumeInternal` | Under `VIEWPORT_RESUME` command |
| `playQueueInternal` → `setQueueInternal` | Under `PLAY_QUEUE` command |

## Remaining violation candidates (trace-only)

1. **`ReleaseCardPlayButton.js`** — direct `upgradeToFullStream()` after preview tap; should migrate to `dispatchPlaybackCommand("upgradeStream")` in a future pass.
2. **`resumeTrackAtPosition`** — exported on context; if `page.js` calls it directly, `resumeInternal` may log violation. At HEAD, only used inside `resumeFromViewport`.

## How to verify

```bash
NEXT_PUBLIC_PLAYBACK_TRACE=1 npm run dev
```

Reproduce: checkout return (entitlements), AV section exit resume, idle session recovery. Watch console for `[PLAYBACK-AUTH-VIOLATION]`.
