# Phase P1 — Playback State Churn Elimination

**Repository:** `/Users/recharge/artist-platform`  
**Date:** 2026-06-03  
**Mode:** Implementation (forensic input: `PHASE_P_FORENSIC_PLAYBACK_TRIGGERED_REFRESH.md`)

---

## Summary

Phase P1 reduces playback-triggered React reconcile on `PageStorefront` / `HomeStorefront` by separating **transport-only** updates from **UI-authoritative** `patchState`, making signed URL swaps UI-invisible, extending stream-command timeouts, and tightening chrome/modal queue transitions—without changing Phase 17–21 lifecycle, 20C recovery, R1 shell isolation, or cinematic UX.

---

## Root causes addressed

| # | Root cause | Fix |
|---|------------|-----|
| 1 | `backgroundStreamResolve` → `swapToSignedStream` → `patchState` churn | Transport-only network flags; signed swap updates `stateRef` + `src` without resetting `isPlaying` / `playbackState` / chrome |
| 2 | `PLAYBACK_COMMAND_TIMEOUT_MS` (15s) false triggers | 120s timeout for `PLAY_TRACK` / `PLAY_QUEUE` / `UPGRADE_STREAM` / `REPLACE_TRACK`; 15s for control commands |
| 3 | Multi-phase `playTrackInternal` `patchState` | Transport fields split to `patchTransport`; same-track load preserves `hasStarted` / `playbackState` where safe |
| 4 | `PlaybackChromeIsland` visual churn | Stable `nowPlaying` when track identity/cover unchanged; deps keyed on track identity not object reference |
| 5 | Modal A→B duplicate transitions | Same-queue `playQueue` skips `cancelActiveStream`, `preserveActiveStream`, index-only `setQueueInternal` |

---

## Part A — Transport-only path (`AudioContext.js`)

### Before

- Every `patchState` called `setState` → `state` in `AudioProvider` `value` `useMemo` deps → full consumer tree reconcile (including `PageStorefront` ancestors).
- `currentTime` was already RAF/ref-only; `playbackNetworkState`, `isBuffering`, and co-located `duration` still forced provider updates.

### After

- **`patchTransport(patch)`** — updates `stateRef`, `transportSnapshotRef`, notifies `subscribeTransport` listeners + `notifyMediaEngineBridge`; **no** `setState`.
- **`patchState`** — if patch is transport-only → `patchTransport` only; if mixed → transport fields peeled to `patchTransport`, UI fields to `setState`.
- **`usePlaybackTransport()`** — `useSyncExternalStore` for `playbackNetworkState` / `isBuffering` (modal/engine buffering UI).
- Provider `value` reads transport from `transportSnapshotRef` (stable across transport-only churn); React `state` dep no longer changes for transport-only patches → **PageStorefront / HomeStorefront do not reconcile** on buffering/network ticks.

**Transport-only keys:** `playbackNetworkState`, `isBuffering`, `currentTime`, `duration`.

---

## Part B — `swapToSignedStream`

### Before

- `patchState({ playbackNetworkState: "loading_stream" })` before/after swap.
- Full `patchState({ currentTrack: … })` after swap (could retrigger chrome/ambient).

### After

- `patchTransport` for network flags only.
- Preserves `wasPlaying`; seeks resume position; updates `currentTrack.src` in `stateRef` when identity matches (no `playbackState` / `isPlaying` reset).
- No duplicate `loading_stream` patch before background resolve.

---

## Part C — Command timeout

### Before

- All commands raced `executePlaybackCommand` against **15s** watchdog.

### After

- Stream commands: **120s** (`PLAYBACK_STREAM_COMMAND_TIMEOUT_MS`).
- Pause/seek/etc.: **15s** unchanged.
- Diagnostic payload includes `timeoutMs` for trace correlation.

---

## Part D — `PlaybackChromeIsland`

### Before

- `useEffect` depended on `currentTrack` object + `playbackState` → `setNowPlaying` on every loading/ready transition.

### After

- Deps use `currentTrackKey` + stable display fields.
- `setNowPlaying` functional update returns **previous** when slug/cover/title/artist unchanged (Phase 21C `continuityFrozen` path preserved).

---

## Part E — Modal / queue track switching

### Before

- Every `playQueue` aborted active stream and re-patched full queue.

### After

- `playbackQueuesMatch()` → `cancelActiveStream: false`, `preserveActiveStream: true`, `setQueueInternal` index-only patch when queue identity unchanged.
- `playTrackInternal` respects `options.preserveActiveStream` (no abort of in-flight resolve for same-album track B).

`ImmersivePreviewModal` `handleTrack` unchanged (toggle same track); page `playAlbumTracks` benefits via `playQueue` optimization.

---

## Files changed

| File | Change |
|------|--------|
| `src/context/AudioContext.js` | Transport patch path, swap, timeout, queue/stream preserve |
| `src/media/useMediaEngine.js` | `usePlaybackTransport` for buffering/network in modal engine |
| `src/components/storefront/PlaybackChromeIsland.js` | Stable nowPlaying / ambient identity |
| `docs/audits/PHASE_P1_PLAYBACK_STATE_CHURN_ELIMINATION.md` | This document |

---

## Validation

```bash
npm run build                 # ✓ pass
npm run check:frontend-guardrails  # run at commit time
```

---

## Preserved hardening

- Phase 17–21 playback lifecycle (21A/B/C truth, 21C continuity snapshot/freeze)
- Phase 20C lifecycle recovery suppression
- R1 PageStorefront auth/catalog reconcile elimination
- Phase 20F scroll, 20G/20H media determinism (no layout/cinematic changes)
