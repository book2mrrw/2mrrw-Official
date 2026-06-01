# Safe Migration Plan — Playback Authority (Phase 8+)

## Completed (Phase 8)

- [x] Extend `PLAYBACK_COMMANDS` + aliases
- [x] `setQueue` public API → `SET_QUEUE` dispatch
- [x] `AudioPhase10Bridge` recovery → `dispatchPlaybackCommand("setQueue")`
- [x] `entitlements:updated` → `UPGRADE_STREAM`
- [x] Viewport exit resume → `VIEWPORT_RESUME` (addresses Phase 7 queue bypass)
- [x] Viewport pause → `VIEWPORT_PAUSE` (`serial: false` to avoid blocking scroll handler)
- [x] Violation logging (non-blocking, trace-gated)
- [x] Export `dispatchPlaybackCommand` on context

## Next passes (do not batch with page.js refactor)

| Priority | Target | Command | Notes |
|----------|--------|---------|-------|
| P1 | `ReleaseCardPlayButton.js` | `upgradeStream` | One call site |
| P2 | Any direct `resumeTrackAtPosition` in `page.js` | `resume` + seek payload | Grep before change |
| P3 | `useImmersivePlayback` `retryStreamPlayback` | `recoverPlayback` | Already public; wire alias if needed |
| P4 | Dead `focus-controller.js` | Remove or wire to viewport commands | Phase 7 info-only |

## Do not migrate without explicit scope

- `src/app/page.js` bulk playback wiring
- `onPause` auto-recover `canplay` listener (behavior change risk)
- `enterAudioVisualViewport` synchronous snapshot logic
- CS hold preview (`beginCsHoldPreview`) — direct element control by design

## Rollback

Selective restore: `src/context/AudioContext.js`, `src/lib/diagnostics/playback-trace.js`, `src/components/system/AudioPhase10Bridge.js` from foundation anchor or pre-Phase-8 commit.
