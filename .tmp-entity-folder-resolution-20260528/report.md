# Entity Folder Resolution + Playback Restoration

**Date:** 2026-05-28  
**Scope:** Canonical media entity folder resolution + playback restoration only.

---

## 1. Resolver implementation summary

### New module: `src/lib/media/entity-resolver.js`

Server-side R2 discovery with 60s in-memory cache per prefix:

| Function | Extension priority |
|----------|-------------------|
| `resolveAudioFile(folder)` | `.wav` > `.flac` > `.m4a` > `.mp3` |
| `resolvePreviewFile(folder)` | same as audio |
| `resolveArtworkFile(folder)` | `.jpg` > `.jpeg` > `.png` > `.webp` |
| `resolveVideoFile(folder)` | `.mp4` > `.webm` > `.mov` |
| `resolveWaveformFile(folder)` | `.json` > `.dat` > `.peak` |
| `resolveWithLegacyFallback(folder, legacy, resolver)` | canonical folder first, flat legacy key second |

Concrete file keys (legacy flat paths) pass through unchanged.

### R2 helpers: `src/lib/storage/r2.js`

- `listR2Objects(prefix)` — paginated ListObjectsV2
- `discoverFileByExtensions(prefix, extensions[])` — priority-ordered match

### Path builders: `src/lib/media/canonical-paths.js`

All builders now return **entity folders** (trailing slash, no filename):

```
digital-assets/singles/{slug}/
digital-assets/features/{slug}/
digital-assets/mixtapes-and-eps/{release}/{track}/
images/singles/{slug}/
previews/singles/{slug}/
videos/singles/{slug}/
```

Helpers added: `normalizeToEntityFolder`, `previewDiscoveryUrl`, `videoDiscoveryUrl`.

---

## 2. Media discovery wiring

| Surface | Change |
|---------|--------|
| `resolve-playback-key.js` | DB folder → `resolveAudioFile` → signed object key |
| `/api/library/stream` | Accepts `trackSlug` for album/EP tracks; cache key includes trackSlug |
| `/api/media/preview` | **New** — folder discovery + legacy fallback → 302 to public CDN |
| `music-access.js` | `libraryStreamRedirectSrc(slug, { trackSlug })` |
| `music-playback.js` | Propagates `trackSlug` in metadata for album tracks |
| `stream-client.js` | `fetchLibraryStream` + `parseStreamTrackSlugFromSrc` |
| `stream-url-cache.js` | Cache key includes trackSlug |
| `signedUrlRefresher.js` | Passes trackSlug on recovery refresh |
| `canonical-catalog.js` | Folder paths + `preview_legacy` fallback via preview API URLs |
| `media-urls.js` | Passes through `/api/media/preview` URLs unchanged |

---

## 3. Remaining stale filename assumptions (src/)

| Location | Notes |
|----------|-------|
| `canonical-catalog.js` | `preview_legacy` flat keys intentional — migration fallback |
| `supabase/migrations/20260529120000_*.sql` | Superseded by `20260529130000_entity_folder_paths.sql` for folder normalization |
| `scripts/migrate-r2-bucket.mjs` | Still lists `digital-assets/singles/{slug}/audio.wav` — ops script, not runtime |
| `supabase/migrations/20260528071100_backfill_feature_storage_paths.sql` | Historical; entity folder migration corrects paths |

**No runtime `audio.wav` / `artwork.jpg` / `loop.mp4` assumptions remain in `src/`.**

---

## 4. Playback validation (code-level)

### Single entitled stream
```
GET /api/library/stream?slug=hour-glass&redirect=1
→ resolvePlaybackKey → folder singles/hour-glass/
→ listR2Objects digital-assets/singles/hour-glass/
→ discover .wav|.flac|.m4a|.mp3 → signed URL
```

### Album track entitled stream
```
GET /api/library/stream?slug=love-hz-vol-1&trackSlug=09-hour-glass&redirect=1
→ catalog_tracks.storage_path → mixtapes-and-eps/love-hz-vol-1/09-hour-glass/
→ discover audio in folder → signed URL
```

### Preview (guest / discovery)
```
GET /api/media/preview?folder=previews/singles/hour-glass/&legacy=previews/hourglass-preview.mp3
→ try folder discovery → fallback legacy flat → 302 public CDN
```

### Build
```
npm run build — ✓ success (Next.js 16.2.4)
```

### Curl probes (require auth + R2 env — not run in CI sandbox)
```bash
# Preview discovery (no auth)
curl -sI "http://localhost:3000/api/media/preview?folder=previews/singles/hour-glass/&legacy=previews/hourglass-preview.mp3"

# Entitled stream (session cookie required)
curl -sI "http://localhost:3000/api/library/stream?slug=hour-glass&redirect=1" -b cookies.txt
curl -sI "http://localhost:3000/api/library/stream?slug=love-hz-vol-1&trackSlug=09-hour-glass&redirect=1" -b cookies.txt
```

---

## 5. Unresolved missing objects (R2 bucket — not verified live)

Discovery fails only when **no audio object** exists in entity folder. Known historical gaps from prior audits:

| Entity folder | Risk |
|---------------|------|
| `digital-assets/features/i-dont-believe-you/` | May still be under legacy `digital-assets/singles/` path in bucket |
| `digital-assets/features/2-heavy/` | Same |
| Canonical preview folders `previews/singles/{slug}/` | Bucket may still have flat `previews/{slug}-preview.mp3` only — legacy fallback covers this |
| Video folders `videos/singles/{slug}/` | Bucket may have flat `videos/singles/{slug}.mp4` — legacy fallback in preview API for video type |

**Action:** Upload masters into canonical entity folders OR rely on legacy fallback until R2 restructure completes.

---

## 6. Legacy preview references

Intentionally retained in `CANONICAL_SINGLES` / `CANONICAL_FEATURES`:

```
previews/hourglass-preview.mp3
previews/turntme2dis-preview.mp3
previews/w2d-preview.mp3
previews/artificial-preview.mp3
previews/i-dont-believe-you-preview.wav
previews/2-heavy-preview.wav
```

Client preview URLs now route through `/api/media/preview?folder=...&legacy=...` which tries canonical folder first.

---

## 7. Mobile validation notes (code-level)

- **Album track streaming:** `trackSlug` now appended to stream URL from `resolvePlaybackSrc` via `metadata.trackSlug` — fixes prior risk where album playback always resolved track 1.
- **Preview playback:** Same-origin `/api/media/preview` redirect works on iOS Safari (no CORS preflight for GET redirect).
- **No AudioContext changes** — orchestration untouched per scope.
- **Stream cache:** Per-track cache keys prevent wrong track audio when switching album tracks on mobile.

---

## Files changed

| File | Action |
|------|--------|
| `src/lib/media/entity-resolver.js` | **Created** |
| `src/lib/storage/r2.js` | Added list + discover |
| `src/lib/media/canonical-paths.js` | Folder-only paths |
| `src/lib/media/canonical-catalog.js` | Folder paths + preview API URLs |
| `src/lib/playback/resolve-playback-key.js` | Entity folder → audio discovery |
| `src/app/api/library/stream/route.js` | trackSlug param |
| `src/app/api/media/preview/route.js` | **Created** |
| `src/lib/music-access.js` | trackSlug in stream URL |
| `src/lib/music-playback.js` | trackSlug metadata |
| `src/lib/playback/stream-client.js` | trackSlug support |
| `src/lib/playback/stream-url-cache.js` | trackSlug cache key |
| `src/lib/media-urls.js` | Preview API URL passthrough |
| `src/system/recovery/signedUrlRefresher.js` | trackSlug on refresh |
| `supabase/migrations/20260529130000_entity_folder_paths.sql` | **Created** |

## Migration to run

```bash
# After 20260529120000_canonical_media_metadata.sql
supabase db push
# or apply: supabase/migrations/20260529130000_entity_folder_paths.sql

# Re-seed products from canonical catalog (optional, aligns JS + DB)
node scripts/seed-products.mjs
```

## Top risks

1. **R2 bucket layout lag** — DB/catalog now folder-authoritative; objects must exist inside folders or legacy fallback paths must remain populated.
2. **Feature masters path** — historical uploads under `digital-assets/singles/` won't be found by `digital-assets/features/` discovery until objects move or symlink.
3. **Preview API latency** — first preview play hits server discovery (cached 60s); acceptable for discovery mode, monitor on mobile.
4. **Prior migration 20260529120000** still seeds filename paths on fresh install — **20260529130000 normalizes immediately after**; order matters.
