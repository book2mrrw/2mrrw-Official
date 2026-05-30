# Files changed

**Commit:** `51af6ff` — `fix(audio): restore Features and album playback via unified track normalization`

## Core

| File | Change |
|------|--------|
| `src/lib/music-playback.js` | Added `normalizeCatalogItemForPlayback`, `buildCatalogPlaybackLookup`, `resolveCatalogPlaybackItem`, `resolveAlbumTrackPlaybackItem`, `titleToCatalogSlug`; `toPlaybackTrack` always normalizes; album tracks resolve per-title slugs; `metadata.previewSrc` |
| `src/app/page.js` | `displayFeatures` + `catalogPlaybackLookup`; all modal open handlers resolve catalog item before `toPlaybackTrack`; `playAlbumTracks` passes lookup |

## UI wiring

| File | Change |
|------|--------|
| `src/components/home/FeaturesRail.js` | Uses pre-normalized `displayFeatures`; removed redundant `withR2CatalogMedia` on play row |
| `src/components/home/CatalogGrid.js` | `albumCardPlaybackItem(item, catalogPlaybackLookup)` |
| `src/components/music/AlbumTracklistSheet.js` | `albumTracksForPlayback(..., catalogPlaybackLookup)` |

## Unchanged (by design)

- `src/context/AudioContext.js`
- `src/media/useMediaEngine.js`
- `src/components/preview/ImmersivePreviewModal.js` (album `onPlayTrackAtIndex` already wired in `5b4cdd3`)
