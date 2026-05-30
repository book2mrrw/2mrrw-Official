# Root causes — Features & Albums audio pipeline

**Commit:** `51af6ff`  
**Deploy:** `dpl_6TVL1w5PT4FakprbpU1dqmTnisDj`  
**Production:** https://www.2mrrw.com

## 1. Features: missing R2 normalization on open path (primary)

| Area | Singles (working) | Features (broken) |
|------|-------------------|-------------------|
| Card click | `openSingleModal(singleUi)` where `singleUi = withR2CatalogMedia(single)` — `page.js` ~1792 | `openFeatureModal(feat)` with **raw** inline `features[]` — `FeaturesRail.js` ~22 |
| Catalog API | `browseSingles` merged with `withR2CatalogMedia` — `page.js` ~724–736 | No `browseFeatures`; static array never R2-wrapped for modal open |
| `toPlaybackTrack` | Resolved preview → R2 CDN via `catalogPreviewAudioUrl` inside `resolvePlaybackSrc` | Same function, but modal item lacked consistent `preview` / `preview_path` aliases and catalog merge |

**File:line**

- `src/app/page.js:1792` — singles pass `withR2CatalogMedia` before `openSingleModal`
- `src/components/home/FeaturesRail.js:22` — features passed raw to `onOpenFeature`
- `src/app/page.js:1114–1119` (before fix) — `toPlaybackTrack(feat, …)` without prior normalization

## 2. Albums: string track rows used album slug for every track

| Property | Single | Feature | Album string track (broken) |
|----------|--------|---------|----------------------------|
| `slug` | `hour-glass` | `i-dont-believe-you` | **`tbh`** (album slug for all rows) |
| `preview` | `/audio/previews/…mp3` | `/audio/previews/…wav` | **`undefined`** (no album-level preview in inline data) |
| `src` (guest) | R2 preview URL | R2 preview URL | **empty** → `playQueue` filtered all tracks |
| `src` (entitled) | `/api/library/stream?slug=hour-glass` | same pattern | `/api/library/stream?slug=tbh` for every row (wrong track) |

**File:line**

- `src/lib/music-playback.js:82–98` (before fix) — `albumTracksForPlayback` built string tracks with `slug: album.slug`
- `src/app/page.js:221–225` — inline albums have `tracks: ["Glass Full", …]` only, no per-track preview

## 3. Album modal track rows did not re-queue playback (secondary, fixed in `5b4cdd3`)

- `ImmersivePreviewModal.js:871–885` — `handleTrack` called `seek(0)` instead of `onPlayTrackAtIndex`
- Wired in `page.js:1602` via `playAlbumModalTrackAtIndex` → `playAlbumTracks`

## 4. Not root causes (verified unchanged / OK)

- Unified `AudioContext` / `useMediaEngine` — no duplicate engine added
- Feature slugs match `products` table (`i-dont-believe-you`, `2-heavy`) — `src/lib/commerce/catalog.js:7–8`
- R2 preview objects return **200** for feature WAV and single MP3 previews
