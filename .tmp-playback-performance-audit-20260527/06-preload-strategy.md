# 6. Preload strategy

## HTML `<audio>` element (AudioContext.js:2396–2403)

```javascript
<audio ref={audioRef} preload="auto" playsInline crossOrigin="anonymous" />
```

- **`preload="auto"`** — browser may buffer entire track aggressively.
- Combined with large WAV previews → high cellular data + memory before user hears 30s cap.

## MediaPreloader (`media/preloader/MediaPreloader.js`)

| Mechanism | When |
|-----------|------|
| `<link rel="preload" as="fetch" crossorigin>` | `preloadTrack()` for **non** `/api/library/stream` URLs |
| Ephemeral `new Audio(); preload="auto"; load()` | Once per preview URL (Set dedupe) |
| Budget gates | `preloadBudget.canPreload("audio")` |

**ReleaseCardPlayButton** (lines 22–32): preloads preview CDN URL + cover on mount.

**Excluded:** library stream URLs (cannot preload without auth cookies meaningfully on link hint).

## Cover / artwork

| Source | Behavior |
|--------|----------|
| `preloadCoverImage` on playTrack | Cancels prior hints, ImagePipeline critical hint |
| `page.js` tab effect | Preloads first 8 singles + radio slides (images) |
| `getArtworkEntriesForTrack` | `await preloadArtwork` before Media Session metadata |
| CS assets | `preloadCsAssets`: video `preload=auto`, cs Audio `preload=auto` |

## Service worker (`public/sw.js`)

- **No audio caching** — only `KEEP_ALIVE` ACK for session persistence.
- Does not intercept media requests.

## page.js catalog preload (lines ~818–829)

- Image pipeline only for visible carousel items — not audio except via ReleaseCardPlayButton per card.

## Gaps / conflicts

1. **`preloadCoverImage` calls `cancelHints()`** — may cancel in-flight audio link preloads from cards when any track plays.
2. **Stream entitled:** no audio preload until tap; first byte waits for API 302 chain.
3. **`preload="auto"`** on main element + large files = contends with LCP on data-constrained networks.

## Recommendations (plan)

- Entitled: `<link rel=prefetch>` to stream redirect URL on card visible (same-origin, credentials).
- Previews: standardize **MP3** for features; target &lt;500KB preview encodes.
- Main audio: `preload="metadata"` until `playTrack` then switch to `auto` for current track only.
- Do not cancel audio preload hints on play unless switching slug.
