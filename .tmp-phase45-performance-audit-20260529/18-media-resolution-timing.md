# 18 — Media Resolution Timing (Resolver Duplication, Eager Loading)

## Resolution layers

```
Client tap
  └─ resolvePlaybackSrc() [music-access.js] — slug → redirect URL or preview CDN

Server /api/library/stream
  └─ resolveProductIdBySlug() [stream-pipeline]
  └─ resolvePlaybackKey() [resolve-playback-key.js]
       ├─ getCanonicalReleaseBySlug() [canonical-catalog.js]
       ├─ Supabase: catalog_tracks, release_media, media_assets, tracks
       └─ entity-resolver: resolveAudio() → R2 list/discover [entity-resolver.js]
  └─ getOrCreateStreamSignedUrl() [stream-url-cache.js]
  └─ createR2SignedGetUrl() [r2.js]
```

## Client-side visual resolution

**Catalog display:** `withR2CatalogMedia()` → `src/lib/media/r2-catalog-media.js`  
**Cover/video URLs:** `catalogMedia.js` → `catalogCoverDisplay()`

Runs at render time for each card — CPU-only (no network) unless URLs trigger fetch.

## Caching tiers

| Cache | TTL | File |
|-------|-----|------|
| Entity discovery | 60s | `entity-resolver.js` L21 |
| Stream signed URL | session-scoped | `stream-url-cache.js` |
| Availability | client write | `availability-cache.js` |
| Image pipeline | session | `imagePipeline/cache.js` |

## Duplication paths

1. **resolvePlaybackKey server + client preview resolution** — different paths by design (entitled vs preview)
2. **Multiple Supabase queries in resolve-playback-key** for albums with trackSlug — sequential awaits (L58–79)
3. **fetchLibraryStream JSON path** re-runs full server chain even when redirect URL already known client-side
4. **Visibility stream refresh** (AudioContext L2646) — may re-fetch when URL still valid

## Eager loading

| Asset | Eager? | File |
|-------|--------|------|
| Hero MP4 | Yes preload=auto | page.js |
| Catalog API | Yes on mount | page.js |
| Cover images | On CoverArt mount | CoverArt.js |
| Stream URL | On play (redirect) | AudioContext |
| Preview audio | On play | CDN direct |

**Preloaders (positive):**
- `useCarouselPreloader.js`, `useQueuePreloader.js`, `useNavigationPreloader.js` in `src/media/preloader/`
- `preloadCoverImage()` in AudioContext on play

## resolve-playback-key serial chain (worst case)

For album track with trackSlug:
1. Product lookup by slug
2. catalog_tracks query
3. release_media + media_assets join OR tracks table
4. R2 folder discovery if no concrete path
5. Sign URL

**Est. 200–800ms server** cold; 60s cache on folder discovery helps repeat.

## Findings

1. **Server resolver is the latency bottleneck** for first entitled play — not client JS.
2. **60s discovery cache** — good; consider longer TTL for stable catalog (future).
3. **Client preloads covers on render** — parallel bandwidth competition with audio on tap.
4. **No duplicate resolver on redirect fast-path client** — clean.

## Validation checklist

- [ ] Server trace: time each step in resolvePlaybackKey for 3 slugs
- [ ] Second play within 60s — compare server time (cache hit)
- [ ] Network: cover preloads vs audio stream priority on tap
