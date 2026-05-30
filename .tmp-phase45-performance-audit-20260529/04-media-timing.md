# 04 — Media Timing (Artwork, MP4 Init/Decode, Resolver, Signed URLs)

## Artwork pipeline

**Primary:** `src/media/imagePipeline/ImagePipeline.js`
- Priority queue with cache (`cache.js`)
- `decoding="async"` on Image elements (L21)
- Skips video/motion URLs for image preload (L7–11)
- `hintPreload()` injects `<link rel="preload" as="image">` (L66–78)

**CoverArt component:** `src/components/ui/CoverArt.js`
- Calls `imagePipeline.preload()` on mount (L29–33)
- Dev mark `ARTWORK_DECODE_START` (no prod timing)
- Video covers use raw `<video>` without poster lazy strategy beyond singles row

**R2 CDN:** `src/lib/media-urls.js` → `catalogCoverUrl`, `catalogPublicMediaUrl`, `getPublicR2Url`

## MP4 / motion loops

**URL builder:** `catalogMotionVideoUrl()` in `src/lib/media-urls.js`  
**Catalog merge:** `src/components/home/catalogMedia.js` → `withR2CatalogMedia`, `catalogCoverDisplay`

| Surface | Preload | File |
|---------|---------|------|
| Hero background | `preload="auto"` | `src/app/page.js` L1783 |
| Singles carousel cards | `preload="metadata"` | `src/components/home/LatestSinglesStyleRow.js` L110 |
| CoverArt video type | none (browser default) | `src/components/ui/CoverArt.js` L83–92 |
| Ambient playback bg | autoPlay loop | `src/components/home/AmbientPlaybackBackground.js` L41–49 |
| Collector cards | `data-cinematic-video="true"` | `src/components/collectors-cards/CollectorCardItem.js` |

## Entity resolver (server-side)

**File:** `src/lib/media/entity-resolver.js`
- 60s in-memory discovery cache (L21–41)
- R2 list + extension discovery per entity folder
- Used by stream route via `resolvePlaybackKey`

**Signed URL cache:** `src/lib/playback/stream-url-cache.js` — keyed by userId+slug+trackSlug

**Stream TTL:** `STREAM_SIGNED_URL_TTL_SECONDS` in stream-pipeline (referenced in route L115–116)

## Timing chain: cover visible → play

1. Card visible → video `preload="metadata"` or image pipeline load
2. Tap play → `preloadCoverImage()` in AudioContext L1412–1414
3. MediaSession artwork fetch — `getArtworkEntriesForTrack` async

## Findings

1. **Hero MP4 `preload="auto"`** competes with JS and catalog API on first load.
2. **Resolver cache 60s** — good for repeat plays; cold first play pays R2 list cost.
3. **Video cards lack IntersectionObserver lazy src** — all cards in DOM get video elements (paused off-screen via scroll sync — good mitigation).
4. **Image pipeline does not dedupe video** — correct; videos bypass pipeline.
5. **Signed URL refresh** 5 min before expiry (`STREAM_REFRESH_BEFORE_EXPIRY_MS` in stream-client.js L4).

## Validation checklist

- [ ] CDN TTFB for representative cover JPG and MP4 moov atom
- [ ] Count R2 list operations per cold stream in server logs
- [ ] Filmstrip: hero video first frame vs FCP
