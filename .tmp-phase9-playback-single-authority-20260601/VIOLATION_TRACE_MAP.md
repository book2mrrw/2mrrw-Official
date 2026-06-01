# Violation Trace Map — Phase 9

## Internal APIs instrumented

| Function | Violation key | When logged |
|----------|---------------|-------------|
| `playTrackInternal` | `playTrackInternal` | `commandExecutionDepthRef === 0` |
| `playQueueInternal` | `playQueueInternal` | same |
| `setQueueInternal` | `setQueueInternal` | same |
| `pauseInternal` | `pauseInternal` | same |
| `resumeInternal` | `resumeInternal` | same |
| `seekInternal` | `seekInternal` | same |
| `upgradeToFullStream` | `upgradeToFullStream` | same |

## Console tags

```
[PLAYBACK-AUTH-VIOLATION] { fn, module, action, reason, stack, timestamp }
[PLAYBACK-SOURCE-TRACE]   { module, action, reason, fn, violation?, timestamp }
```

## Stack parsing

`parsePlaybackCallerFromStack` in `playback-trace.js` skips frames matching `AudioContext`, `playback-trace`, and command executor symbols; first external `*.js` filename becomes `module`.

## Expected violations (informational)

During soft migration, dev consoles may still show violations from:

- Legacy direct `*Internal` calls if any remain outside the command queue
- `playNextInternal` / `playPreviousInternal` calling `playTrackInternal` without nested depth (should not occur when routed via `NEXT_TRACK` / `PREV_TRACK` commands)

Treat as migration backlog, not user-facing errors.

## Grep audit (2026-06-01)

| Area | Direct mutation | Status |
|------|-----------------|--------|
| `AuthContext.js` | None | OK |
| `stream-client.js` | None (fetch/log only) | OK |
| `ReleaseCardPlayButton.js` | Was `upgradeToFullStream` in timer | **Fixed** → `upgradeStream` command |
| `AlbumTracklistSheet.js` | Used `playQueue` wrapper | **Migrated** → explicit `dispatchPlaybackCommand` |
| `page.js` | `playTrack`/`playQueue` in callbacks only | OK (no useEffect playback) |
| `AudioPhase10Bridge.js` | `dispatchPlaybackCommand` on window event | OK |
