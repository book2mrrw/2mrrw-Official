# Files Changed — Phase 4.6

## Modified (11)

| File | Lines Δ | Optimizations |
|------|---------|---------------|
| `src/context/AudioContext.js` | +214/−~ | A1: progress isolation, `usePlaybackProgress()`, `getCurrentTime()`, `subscribeProgress` |
| `src/app/page.js` | +280/−~ | A2/A3, B1/B2/B3, C1/C2, `StorefrontMiniPlayerBar` |
| `src/components/home/AmbientPlaybackBackground.js` | +8/−~ | C3: mobile blur 72px |
| `src/media/useMediaEngine.js` | +17/−~ | A1: progress subscription layer |
| `src/lib/player/useImmersivePlayback.js` | +12/−~ | A1: progress via hook |
| `src/components/preview/GlyphLyricsPanel.js` | +4/−~ | A1: `usePlaybackProgress` |
| `src/components/system/AudioPhase10Bridge.js` | +4/−~ | A1: `getCurrentTime` for recovery |
| `src/system/recovery/usePlaybackRecovery.js` | +6/−~ | A1: live position via getter |
| `src/components/media/_deprecated/ModalAudioPlayer.js` | +5/−~ | A1: progress hook |
| `src/lib/dev/performanceMarks.js` | +47/−0 | Pre-existing instrumentation (Phase 4.5 latency audit) |
| `src/lib/playback/stream-client.js` | +5/−0 | Pre-existing instrumentation marks |

## New API surface

```javascript
// src/context/AudioContext.js
export function usePlaybackProgress() // { currentTime, duration }
// Context value additions:
// getCurrentTime(), subscribeProgress, getProgressSnapshot
// Removed from value spread: currentTime (use hook instead)
```

## New components (inline)

| Symbol | Location | Purpose |
|--------|----------|---------|
| `StorefrontMiniPlayerBar` | `src/app/page.js` | Memoized desktop/mobile mini-player with isolated progress subscription |

## Dynamic imports added (page.js)

- `ImmersivePreviewModal`
- `AlbumModal`
- `GiftBottomSheet`
- `CollectorCardAdminPanel`
- `VaultUnlockedRoom`
- `CheckoutForm`
- `AlbumTracklistSheet`

## Total diff stat

```
11 files changed, 428 insertions(+), 174 deletions(-)
```
