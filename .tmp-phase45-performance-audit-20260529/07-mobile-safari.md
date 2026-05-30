# 07 — Mobile Safari (Memory, visibilitychange, Background, Constraints)

## Platform target

Build frame of mind: iOS Safari, one thumb, in motion — primary optimization surface.

## Memory pressure sources

| Source | File | Risk |
|--------|------|------|
| Hero full-screen MP4 decode | `page.js` L1783 | High |
| N singles carousel `<video>` elements | `LatestSinglesStyleRow.js` | Medium — paused off-screen |
| Ambient background dual layers (base + CS) | `AmbientPlaybackBackground.js` | Medium when playing |
| Large CSS blur filters | `globals.css`, ambient bg L22 | GPU memory |
| 2.74 MB JS heap baseline | build chunks | Medium |

**Mitigation present:** `syncSinglesCarouselVideos` pauses off-screen videos (`page.js` L631–641).

## visibilitychange handling

### AudioContext (`src/context/AudioContext.js` L2620–2705)

**On hidden:**
- Saves playback position
- May refresh stream URL if near expiry
- Sets `wasPlayingBeforeHideRef`

**On visible:**
- iOS: may set `isPlaying: false` instead of auto-resume (L2679–2680 `isLikelyIOS()`)
- Non-iOS: `dispatchPlaybackCommand(RECOVER)`
- Rehydrates MediaSession

### useSyncEngine (`src/hooks/sync/useSyncEngine.js` L82–98)

- Listens `visibilitychange` + `focus` for resync
- Circuit breaker after 3 failures (30s open)

## Background audio

- Single `<audio>` element in AudioProvider (L2955–2962) — **correct pattern**
- Service worker keep-alive ping every 20s (`KEEP_ALIVE_INTERVAL_MS` L64, `public/sw.js`)
- MediaSession API for lock screen (`updateMediaSession` L615+)
- `playsInline`, `webkit-playsinline`, `x-webkit-airplay` on audio element

## Safari-specific constraints

| Constraint | Handling | Gap |
|------------|----------|-----|
| Autoplay | Muted video loops OK; audio requires gesture | unlockAudioFromGesture |
| Web Audio suspend | resumeWebAudioContextIfSuspended | OK |
| Background tab throttle | visibility handler | iOS conservative resume |
| 300ms tap delay | Modern iOS minimal | OK |
| IndexedDB/storage | playback position in localStorage pattern | verify quota |
| PWA standalone | isStandalonePwa checks in beforeunload | OK |

## Safe areas

Mobile nav sheets use `env(safe-area-inset-bottom)` (`page.js` L2562, L2656).

## Findings

1. **Multiple decoded videos on Home** — Safari may evict audio buffer under memory pressure.
2. **iOS visibility recover intentionally conservative** — user may need second tap after tab switch.
3. **blur(120px) on full-viewport video** — expensive on A-series GPUs.
4. **SW keep-alive** — minimal SW (`public/sw.js`, 21 lines) — low overhead.

## Validation checklist

- [ ] Safari Web Inspector: Memory timeline scrolling Home with 15 singles
- [ ] Background app 30s → foreground — playback continuity
- [ ] Low Power Mode ON — hero video + playback behavior
