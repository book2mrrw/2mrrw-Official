# 10. Singles vs Features diff

## Data source differences

| Aspect | Singles | Features |
|--------|---------|----------|
| Catalog | `page.js` `INLINE_SINGLES` | `catalog.js` `PRODUCT_CATALOG` + browse API |
| Preview format | `.mp3` under `/audio/previews/` | `.wav` in catalog `preview_path` |
| CDN size (probed) | ~0.8–1.2 MB | ~5.0–6.5 MB |
| Slug resolution | In-card slug present | `resolveCatalogPlaybackItem` + lookup maps |
| Modal | `openSingleModal` → ImmersivePreviewModal | `openFeatureModal` |

## Shared pipeline (post 97f2439)

Both use:

1. `resolveCatalogPlaybackItem(item, catalogPlaybackLookup)`
2. `toPlaybackTrack(item, accountState, source)`
3. `resolvePlaybackSrc` → preview CDN or `libraryStreamRedirectSrc`
4. `playTrack` / `playQueue` in AudioContext

## Commit `97f2439` — features playback fix

**Problem:** Features could fail preview fallback when stream denied because `previewSrc` in metadata was only set when `!canStream`, and fallback used `metadata.previewSrc` without resolving `preview_path`.

**Changes:**

| File | Change |
|------|--------|
| `music-playback.js` | `previewSrc = previewPath ? catalogPreviewAudioUrl(previewPath) : null` **always** |
| `AudioContext.js` | Stream 401 **and 403** → `getTrackPreviewSrc(track)` chain for fallback |
| `entitlements.js` | (related entitlement check — see commit) |

## Remaining asymmetry (performance, not correctness)

1. **Asset weight:** Features pay **~5×** download cost for previews.
2. **Preload:** `ReleaseCardPlayButton` preloads preview URL — WAV warms entire multi-MB file.
3. **Modal source string:** `"preview_modal"` vs `"feature_modal"` — telemetry only.

## Album path (reference)

- `openAlbumModal` → `playAlbumTracks` → `albumTracksForPlayback` + `playQueue`
- Uses same `toPlaybackTrack` per track row

## Verification matrix

| Case | Single | Feature |
|------|--------|---------|
| Guest tap | MP3 CDN | WAV CDN |
| Subscriber | redirect stream | redirect stream |
| Stream 403 + entitled flag | preview fallback | preview fallback (fixed 97f2439) |
| Card preload | MediaPreloader | MediaPreloader |

## Plan

- Re-encode feature previews to MP3/AAC matching singles policy.
- Add `preview_path` to singles in catalog for single source of truth (optional).
- Document expected preview loudness/format in `PRODUCT_CATALOG`.
