# Playback Stabilization Preflight — 2026-05-28

Scope: cache clearing, catalog rebuild helpers, R2 verification, stale path audit, playback init chain validation. No UI or AudioContext orchestration changes.

## 1. Caches cleared / added

| Module | Export | Behavior |
|--------|--------|----------|
| `src/lib/playback/stream-url-cache.js` | `clearStreamUrlCache()` / `clearCache()` | Clears signed URL Map + inflight promises; `invalidateStreamCacheForUser` now also clears inflight |
| `src/lib/media/entity-resolver.js` | `clearEntityResolverCache()` / `clearEntityResolverCaches()` | Clears 60s R2 discovery cache |
| `src/lib/media/canonical-catalog.js` | `clearCanonicalCatalogCache()` / `rebuildCanonicalCatalogMappings()` | Drops memoized slug indexes; rebuild re-enriches folder paths |
| `src/lib/media/cache-invalidation.js` | `clearMediaResolverCaches()` | Central entry — entity resolver + stream URL + catalog indexes |
| `src/app/api/library/stream/route.js` | (dev only) | `force=true` GET clears `clearMediaResolverCaches()` when `NODE_ENV=development` |
| `src/lib/playback/position-memory.js` | (documented) | Keys are `2mrrw_pos_{userId}_{slug}` — seconds only, no R2 paths; use `clearPlaybackPosition` per slug |
| `src/system/recovery/signedUrlRefresher.js` | — | No internal cache; uses `fetchLibraryStream(..., { force: true })` |

## 2. Canonical catalog

- **Single source:** `src/lib/media/canonical-catalog.js` — `CANONICAL_SINGLES`, `CANONICAL_FEATURES`, `CANONICAL_ALBUMS`, `CANONICAL_TRACKS`
- **Commerce:** `src/lib/commerce/catalog.js` imports `getCanonicalProductRows()` only
- **Playback:** `src/lib/music-playback.js` → `mergeCanonicalMetadata()` + `withR2CatalogMedia()` before `resolvePlaybackSrc`
- **Rebuild:** `rebuildCanonicalCatalogMappings()` returns sorted singles/features/albums + product/track rows

## 3. R2 verification (live)

**Script:** `node scripts/verify-r2-entity-folders.mjs` (add `--json` for full output)

**Bucket:** `2mrrw-media` (credentials from `.env.local`)

| Metric | Count |
|--------|------:|
| Entities probed | 39 |
| With audio | 17 |
| With preview (folder) | 4 |
| With artwork | 9 |
| With video | 4 |

### Singles (OK)

| Slug | Audio | Preview | Artwork | Video |
|------|-------|---------|---------|-------|
| hour-glass | `digital-assets/singles/hour-glass/audio.mp3` | `previews/singles/hour-glass/hourglass-preview.mp3` | yes | yes |
| turnt-me-2-dis | yes | yes | yes | yes |
| w2d | yes | yes | yes | yes |
| artificial | yes | yes | yes | yes |

### Features (BLOCKED — no audio in bucket)

| Slug | Canonical audio prefix | singles/ fallback | Legacy preview key |
|------|------------------------|-------------------|---------------------|
| i-dont-believe-you | `digital-assets/features/…` empty | `digital-assets/singles/…` empty | `previews/i-dont-believe-you-preview.wav` **missing** |
| 2-heavy | same | same | `previews/2-heavy-preview.wav` **missing** |

Artwork exists under `images/features/{slug}/`. Preview/play for guests relies on legacy flat keys or folder discovery — both absent for features.

### Album tracks (partial)

17 album tracks have audio under `digital-assets/mixtapes-and-eps/{album}/{track}/`. **19 tracks missing audio** (see script `--json` → `missingAudio`).

## 4. Stale filename grep (`src/`)

| Pattern | Hits | Playback impact |
|---------|------|-----------------|
| `audio.wav`, `preview.mp3`, `artwork.jpg`, `loop.mp4` | **None** in playback init paths |
| Hardcoded `digital-assets/.../filename` | **None** in stream-client, resolve-playback-key, music-access, library/stream |
| `preview_legacy` flat keys | `canonical-catalog.js` only — used as fallback via `/api/media/preview?legacy=` |

**Fix applied:** `resolve-playback-key.js` — when `features/` folder is empty, retry `singles/` prefix (R2 migration drift).

## 5. Playback init chain (validated, read-only)

```
Play button (page.js / ReleaseCardPlayButton / MyMusicTab)
  → playCanonicalCatalogItem / playTrack / playQueue
  → normalizeCatalogItemForPlayback (mergeCanonicalMetadata + withR2CatalogMedia)
  → normalizeTrackForPlayback / toPlaybackTrack
  → resolveTrackAccess + resolvePlaybackSrc
       entitled → /api/library/stream?slug=…&redirect=1
       preview  → catalogPreviewAudioUrl → /api/media/preview?folder=…
  → AudioContext.playTrackInternal
  → waitAudioSrcReady (canplay / loadedmetadata / 15s timeout)
  → audio.play()
  → patchState hasStarted: true
  → GlobalAudioPlayerBar visible when hasStarted || loading|ready|playing|preview_fallback
```

### Content-type validation

- **Redirect path:** browser follows 302 to signed R2; no JSON prefetch HEAD
- **JSON prefetch path:** `fetchLibraryStream` → `assertSignedAudioUrl` HEAD on presigned URL
- **Failure codes:** `AUDIO_SRC_INVALID`, `AUDIO_SRC_READY_TIMEOUT`, `SIGNED_STREAM_UNREACHABLE`, API 404 when `resolvePlaybackKey` returns null

## 6. Build

`npm run build` — **passed** (Next.js 16.2.4, no compile errors).

## 7. Remaining blockers (play button / timeline / duration)

| Priority | Blocker | Symptom |
|----------|---------|---------|
| **P0** | Feature WAV masters + previews absent from R2 | Entitled feature play → stream 404; guest preview → silent / no src |
| **P1** | 19 album tracks missing R2 audio folders | Album modal track play fails for those rows |
| **P2** | Feature DB paths (`features/`) vs empty R2 | Mitigated by singles/ fallback in code; **still fails** until objects uploaded |
| **P3** | Preview folder migration incomplete | Singles use `previews/singles/{slug}/`; features still point at missing legacy flat keys |
| **P4** | Duration/timeline | Depends on successful `loadedmetadata`; blocked when src 404 or HEAD fails on prefetch path |
| **P5** | iOS Safari WebAudio suspend | Mitigated by gesture unlock in AudioContext; not a path/cache issue |

### Top actions (outside this diff)

1. Upload feature masters to `digital-assets/features/{slug}/` (or `singles/` if keeping legacy layout) + preview WAVs
2. Upload missing mixtape track folders per `missingAudio` list from verify script
3. Re-run `node scripts/seed-products.mjs` after migration `20260529130000_entity_folder_paths.sql` so DB storage_path matches folder-only shape
4. Dev cache bust: `GET /api/library/stream?slug=…&force=true` (development only)

## Files changed

- `src/lib/playback/stream-url-cache.js`
- `src/lib/media/entity-resolver.js`
- `src/lib/media/canonical-catalog.js`
- `src/lib/media/cache-invalidation.js` (new)
- `src/lib/playback/resolve-playback-key.js`
- `src/lib/playback/position-memory.js` (docs)
- `src/app/api/library/stream/route.js`
- `scripts/verify-r2-entity-folders.mjs` (new)
