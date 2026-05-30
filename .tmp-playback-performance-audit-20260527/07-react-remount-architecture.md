# 7. React remount architecture

## Provider tree (`src/app/layout.js`)

```
AuthProvider
  StripeProvider
    AudioProvider          ← single <audio> lives here
      children (pages)
      GlobalAudioPlayerBar ← sibling, always mounted
```

- **Audio element does not remount** on `page.js` tab switches (same layout).
- **Risk:** entire `page.js` re-renders are large but do not destroy AudioProvider.

## State model

| Layer | Responsibility |
|-------|----------------|
| `AudioContext` | Source of truth: track, queue, play/pause, stream meta, Web Audio |
| `mediaEngineBridge` | `registerMediaEngineBridge` + `useSyncExternalStore` in `useMediaEngine` |
| `GlobalAudioPlayerBar` | `useImmersivePlayback` + `useMediaEngine` (dual read) |
| `ImmersivePreviewModal` | `useMediaEngine` only — no second audio element |

## Re-render triggers on play

1. `patchState` in `playTrack` → full context consumers re-render
2. `onPlay` / `timeupdate` → `currentTime` via RAF (`startProgressRaf`) — **high frequency**
3. `GlobalAudioPlayerBar` uses `useRenderTracker` (dev) — watch subscriber count

## `startTransition` usage

- Queue updates (`setQueue`) — non-urgent (1824–1828)
- Carousel index in page.js — non-urgent

Play path uses **urgent** `setState` (no transition) — correct for latency.

## Modal + play coupling (`page.js`)

| Handler | Play | Other work |
|---------|------|------------|
| `openSingleModal` | `playTrack(toPlaybackTrack(...))` sync void | `getControlSystemReleaseDetail` async |
| `openFeatureModal` | same | same |
| `openAlbumModal` | `playAlbumTracks` → `playQueue` | dismiss other modals |

Modal mount (`ImmersivePreviewModal`) is **after** play starts — modal animation (`useModalAnim` double rAF) does not gate audio.

## Components that must stay mounted

- `AudioProvider` / hidden `<audio>`
- `GlobalAudioPlayerBar` (lock screen / mini player continuity)
- `AudioPhase10Bridge` (inside provider)

## Remount risks (low today)

| Scenario | Effect |
|----------|--------|
| Full layout remount (HMR, rare navigation) | Audio stops; `streamMetaRef` lost |
| `stop()` | Clears src + EMPTY_STATE |
| Strict Mode double mount (dev) | Possible double listener attach — guarded by effect cleanup |

## Plan

- Split AudioContext: stable playback ref API + shallow context for UI state to reduce bar re-renders.
- Memoize `GlobalAudioPlayerBar` children; move scrub RAF to ref-only updates where possible.
