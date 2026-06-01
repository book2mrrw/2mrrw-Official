# Playback Prewarm Strategy — Phase 5.2.6

## Objective

Shift catalog normalization, queue descriptor assembly, and URL *shape* computation from **after tap** to **when a release card enters the viewport** — without changing playback behavior, entitlements, or fetching audio bytes.

## Architecture

```
Viewport (IntersectionObserver)
    └── PlaybackPrewarmCardShell
            └── usePlaybackCardPrewarm
                    └── buildReleasePrewarmBundle()
                            └── playback-prewarm-cache Map (key: release:track)
                                    └── ReleaseCardPlayButton tap → getPlaybackPrewarmEntry()
```

## Cache contract

| Field | Content | Network? |
|-------|---------|----------|
| `key` | `{releaseSlug}:{trackSlug\|trackIndex}` | No |
| `normalizedFirst` | R2-resolved catalog item for first playable track | No |
| `firstTrackPlayback` | `toPlaybackTrack()` output at warm time (metadata) | No bytes |
| `urlDescriptor` | `previewSrc`, `streamPath` strings only | No fetch — strings only |
| `queueDescriptors` | `{ trackIndex, trackSlug, title }[]` for full release | No |

**Max entries:** 96 (LRU trim).  
**Signed URLs:** Never stored or prefetched.  
**Entitlements:** `resolveTrackAccess` runs client-side only (same as today); no stream session creation.

## Card integration

| Component | Trigger | First track |
|-----------|---------|-------------|
| `LatestSinglesStyleRow` | `PlaybackPrewarmCardShell` per card | Single/feature item or `albumCardPlaybackItem` for cover rows |
| `CatalogGrid` | Same shell on non-upcoming album cards | `albumCardPlaybackItem` + track index 0 |

Observer options: `threshold: 0.15`, `rootMargin: 80px 0px` (matches scroll-ahead intent without aggressive work off-screen).

## URL preparation audit

| Path | Safe to precompute? | Notes |
|------|---------------------|-------|
| Preview folder discovery | Yes | `/api/media/preview?folder=…` — no entitlement |
| Direct R2 preview CDN URL | Yes | Public path from `catalogPreviewAudioUrl` |
| Library stream redirect | Yes | `/api/library/stream?slug=…&redirect=1` — signing happens on server at request time |
| Signed R2 GET URL | **No** | Only returned after entitled stream handler runs |
| Offline blob URL | **No** | User-specific; resolved at tap |

## Prohibited (verified absent)

- No autoplay
- No `audio.load()` / byte prefetch in prewarm path
- No `fetchLibraryStream` / stream session side effects
- No hybrid flag reads in prewarm modules

## Tap path change

`ReleaseCardPlayButton` checks prewarm cache for `normalizedFirst` before `toPlaybackTrack`, skipping repeat catalog normalization when card was visible. Access and `src` are still resolved fresh at tap via `toPlaybackTrack(item, accountState)`.

## Existing preload (unchanged)

`ReleaseCardPlayButton` still runs legacy `preloadTrack()` for preview URLs on mount — predates 5.2.6; not expanded in this phase per “no aggressive preload” scope.

## Dev verification

On localhost after scrolling cards into view:

```js
// After cards visible, before tap:
import { playbackPrewarmCacheStats } from '@/lib/playback/playback-prewarm-cache';
playbackPrewarmCacheStats(); // { size: N, max: 96 }
```

After tap, `window.dumpPlaybackTiming()` — expect modest reduction in tap→request/resolver stages; tap→audible still dominated by decode (Phase 5.2.4 finding).
