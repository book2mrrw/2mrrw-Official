# Master lookup code path — Phase 5.3.3A

## End-to-end backfill flow (catalog track)

```
scripts/backfill-stream-assets.mjs
  fetchTrackCandidates()          → catalog_tracks.storage_path (NOT NULL)
  resolveTrackReleaseType(row)    → album metadata.release_type OR infer from storage_path segment
  generateStreamAssetForCatalogTrack({ storagePath, releaseType, albumSlug, trackSlug })
```

## Stream generation gate

`src/lib/media/stream-upload-pipeline.js` → `generateStreamAssetForCatalogTrack`

1. `isAutoGenerateStreamAssetsEnabled()` — must be true (`--yes` or env).
2. `registerStreamAsset({ releaseType, slug: trackSlug, trackSlug, albumSlug })`  
   → `src/lib/media/stream-registration.js` + `canonical-paths.js`  
   → planned `stream_key` e.g. `streaming/mixtapes-and-eps/{album}/{track}/{track}_192.m4a`
3. If stream object exists in R2 and not `--force` → skip.
4. **`masterKey = await resolveMasterR2Key(storagePath)`** — failure point for all 10.
5. If `!masterKey` → `{ ok: false, error: "master_not_found" }` (no transcode).

## Master key resolution

```
resolveMasterR2Key(storagePath)
  normalizeStoragePathForStorefront(storagePath)     → src/lib/sync/normalize-storage-path.js
    Input:  mixtapes-and-eps/ad/03-said-n-done/
    Output: digital-assets/mixtapes-and-eps/ad/03-said-n-done/
  resolveAudioFile(normalized)                       → src/lib/media/entity-resolver.js
    normalizeToEntityFolder(path)                    → src/lib/media/canonical-paths.js
      Strips trailing filenames; strips wrong nested dirs (audio/, artwork/, …)
    discoverInFolder(folder, [.wav, .flac, .m4a, .mp3])
      discoverFileByExtensions()                   → src/lib/storage/r2.js
        listR2Objects(prefix, { recursive: false })  → Delimiter "/" — **direct children only**
        Returns first key matching extension priority
```

## What is NOT consulted

| System | Used for master backfill? |
|--------|---------------------------|
| `resolve-playback-key.js` | No — playback only |
| `canonical-catalog.js` in-memory paths | No — DB `storage_path` wins |
| `protected-media/` prefix | No — unless `storage_path` starts with `masters/` or `previews/` |
| Recursive R2 listing | No — nested `audio/master.wav` ignored by design (2026-05-28 flat-folder fix) |
| Legacy flat key `…/audio.wav` HEAD | No — only folder discovery unless path is already a concrete file key |
| Singles duplicate (`digital-assets/singles/w2d/`) | No — EP track uses EP `storage_path` only |

## Playback parity

Entitled stream playback (`resolve-playback-key.js`) uses the same entity-folder + `resolveAudio` pattern when no `stream_key` is registered. These 10 tracks will also miss master fallback until paths align.

## Example trace (failed track)

**DB:** `catalog_tracks` slug `03-said-n-done`, `storage_path` = `mixtapes-and-eps/ad/03-said-n-done/`

| Step | Value |
|------|-------|
| Normalized R2 prefix | `digital-assets/mixtapes-and-eps/ad/03-said-n-done/` |
| `listR2Objects` direct children | `[]` (empty — canonical folder absent) |
| Actual R2 location (live probe) | `digital-assets/mixtapes-and-eps/ad/03-said-n-done /Said N' Done (A.D).wav` |
| `resolveAudioFile` result | `null` |
| Backfill error | `master_not_found` |

## Example trace (successful sibling)

**DB:** `02-here-i-come`, `storage_path` = `mixtapes-and-eps/ad/02-here-i-come/`

| Step | Value |
|------|-------|
| Normalized prefix | `digital-assets/mixtapes-and-eps/ad/02-here-i-come/` |
| Discovered key | `…/02-here-i-come/Here I Come (Freestyle) (A.D).mp3` |
| Backfill | Success → stream registered |
