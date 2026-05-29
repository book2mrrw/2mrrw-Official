# Media render fix — 2026-05-28

## Prompt requirements

1. Diagnose full media resolution path for `hour-glass` (video, preview, full audio, cover)
2. Fix path resolution: `{domain}/{releaseType}/{releaseSlug}/` (singles/features) or `{domain}/{releaseType}/{releaseSlug}/{trackSlug}/` (albums/mixtapes)
3. Fix video loop rendering — MP4 loops via folder discovery
4. Fix audio rendering — previews and full audio via entity folders
5. Verify `PREVIEW_ROOT = "previews"`; revert any `"audio"` usage
6. No hardcoded extensions/filenames — list folder and serve first file
7. Preserve folder-authoritative architecture from ca6c565/9e8da66

## Root cause

Commits ca6c565 and 9e8da66 correctly added **releaseSlug entity folders** for all release types, but incorrectly set `PREVIEW_ROOT = "audio"`. The R2 bucket stores preview audio under `previews/{releaseType}/{releaseSlug}/`, not `audio/...`.

Every preview discovery call (`resolvePreviewPath`, `/api/media/preview`, legacy fallback keys) pointed at non-existent `audio/singles/hour-glass/` folders → 404 → no preview audio anywhere.

Video and full-audio paths were structurally correct (`videos/`, `digital-assets/`) but previews blocked all guest playback; entitled stream fallback-to-preview also failed.

## Diagnosis — `hour-glass` paths

| Media type | Before (broken) | After (fixed) |
|------------|-----------------|---------------|
| Video loop | `videos/singles/hour-glass/` ✓ (unchanged) | `videos/singles/hour-glass/` |
| Preview audio | `audio/singles/hour-glass/` ✗ | `previews/singles/hour-glass/` |
| Full audio | `digital-assets/singles/hour-glass/` ✓ | `digital-assets/singles/hour-glass/` |
| Cover image | `images/singles/hour-glass/` ✓ | `images/singles/hour-glass/` |

### Resolution chain (after fix)

1. `page.js` inline single → `withR2CatalogMedia` → `mergeCanonicalMetadata`
2. `enrichRelease('hour-glass')` builds:
   - `preview`: `/api/media/preview?folder=previews/singles/hour-glass/&legacy=previews/singles/hour-glass/hourglass-preview.mp3`
   - `visual`/`video`: `/api/media/visual?releaseType=singles&slug=hour-glass&legacyVideo=...&legacyImage=...`
3. `/api/media/preview` → `resolvePreviewFile` → lists `previews/singles/hour-glass/` → 302 to CDN
4. `/api/media/visual` → `resolveVisualMedia` → lists `videos/singles/hour-glass/` → 302 to CDN
5. Entitled playback: `/api/library/stream?slug=hour-glass` → `digital-assets/singles/hour-glass/` folder discovery

## Files changed

| File | Change |
|------|--------|
| `src/lib/media/constants/storage-domains.js` | `PREVIEW_ROOT`: `"audio"` → `"previews"` |
| `src/lib/media/canonical-paths.js` | Fix `normalizeLegacyPreviewPath`; stop remapping `previews/` → `/audio/` |
| `src/lib/media/canonical-catalog.js` | All `preview_folder` / `preview_legacy` keys: `audio/` → `previews/`; album track `enrichTrack` adds per-track preview discovery |
| `src/lib/media-urls.js` | Remove wrong `audio/` CDN branch; add explicit `previews/` handling |
| `src/lib/music-playback.js` | Album track playback uses `canonicalTrack.preview` |

## Preserved from ca6c565/9e8da66

- Entity-folder path pattern with releaseSlug for all release types
- `mergeCanonicalMetadata` + `withR2CatalogMedia` uniform application
- Folder listing via `entity-resolver.js` (no hardcoded filenames)
- Video/image/full-audio domain roots unchanged

## Verification

- `npm run build` — **PASS**
- API routes present: `/api/media/preview`, `/api/media/visual`, `/api/library/stream`
- `PREVIEW_ROOT = "previews"` confirmed in `storage-domains.js`

## Manual QA checklist

- [ ] Latest singles carousel — MP4 loop visible for Hour Glass
- [ ] Guest preview — singles, features, mixtape/EP tracks play
- [ ] Entitled user — full audio via `/api/library/stream`
- [ ] No 404 on `/api/media/preview?folder=previews/singles/hour-glass/`
