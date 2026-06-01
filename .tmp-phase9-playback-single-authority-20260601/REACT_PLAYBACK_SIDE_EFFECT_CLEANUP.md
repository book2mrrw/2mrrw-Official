# React Playback Side-Effect Cleanup — Phase 9

## Audit method

```bash
rg 'useEffect' src -l | xargs rg -l 'playQueue|playTrack|upgradeToFullStream|setQueue|pause\(' 
```

Cross-check: playback call inside `useEffect` body (not merely importing hooks).

## Findings

### No change required

| File | Notes |
|------|-------|
| `page.js` | `playTrack` / `playQueue` only in `useCallback` handlers (`playAlbumTracks`, `playCanonicalCatalogItem`); effects handle ambient video, nowPlaying UI, catalog fetch |
| `AlbumTracklistSheet.js` | Effects: drag reset, modal stack — playback only in `playAndClose` callback |
| `ReleaseCardPlayButton.js` | Effect: preview preload only |
| `AudioPhase10Bridge.js` | Effect registers `2mrrw:playback-recovery` listener; dispatch on **event**, not on `[queue]` deps |
| `AuthContext.js` | No playback imports |
| `usePlaybackCardPrewarm.js` | Memory warm only, no autoplay |

### Fixed in Phase 9

| File | Issue | Fix |
|------|-------|-----|
| `ReleaseCardPlayButton.js` | Preview upgrade timer called `upgradeToFullStream()` directly | `dispatchPlaybackCommand('upgradeStream')` |
| `ReleaseCardPlayButton.js` | Used `playQueue` wrapper | `dispatchPlaybackCommand('playQueue', { tracks, startIndex })` |
| `AlbumTracklistSheet.js` | Used `playQueue` wrapper | Explicit `dispatchPlaybackCommand('playQueue', …)` |

### Deferred (explicit scope)

| File | Notes |
|------|-------|
| `page.js` | Bulk wiring / `resumeTrackAtPosition` — SAFE_MIGRATION_PLAN P2 |
| `MyMusicTab.js`, `PlaylistDetail.js`, `ContinueListening.js` | Wrappers already enqueue commands; migrate to `dispatchPlaybackCommand` in a later pass |

## Guideline

Route playback through **event handlers** (click, custom DOM events, entitlement listener inside AudioContext). Never tie playback to React dependency arrays for catalog, auth, or route state.
