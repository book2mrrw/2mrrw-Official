# Multimedia Fallback Implementation — 20260528

## Resolver implementation summary

**Core module:** `src/lib/media/entity-resolver.js`

| Export | Behavior |
|--------|----------|
| `resolveAudio` / `resolveAudioFile` | Entity folder → `.wav` > `.flac` > `.m4a` > `.mp3` |
| `resolvePreview` | Folder discovery + optional legacy flat key via `resolveWithLegacyFallback` |
| `resolvePreviewFile` | Preview-specific discovery (used by `/api/media/preview`) |
| `resolveArtwork` / `resolveArtworkFile` | `.jpg` > `.jpeg` > `.png` > `.webp` |
| `resolveVideo` / `resolveVideoFile` | `.mp4` > `.webm` > `.mov` |
| `resolveWaveform` / `resolveWaveformFile` | `.json` > `.dat` > `.peak` (optional; never blocks playback) |
| `resolveVisualMedia(releaseType, slug, trackSlug?, options)` | Video folder first, then `images/` fallback; returns `{ type, key, url, source }` |
| `resolveWithLegacyFallback` | Canonical folder → legacy flat file key |

**Path builders:** `src/lib/media/canonical-paths.js`

- Four domains: `digital-assets/`, `previews/`, `images/`, `videos/`
- `RELEASE_FOLDER`: singles, features, mixtapes-and-eps, **albums** (new mapping for `album` release type; EP/mixtape catalog unchanged)
- Nested track paths for mixtapes-and-eps / albums
- `visualDiscoveryUrl()`, `visualDiscoveryUrlFromFolder()` for client/API URLs

**Playback:** `src/lib/playback/resolve-playback-key.js` uses `resolveAudio` — only missing full audio blocks playback.

## Video → image fallback wiring

**New route:** `GET /api/media/visual`

- Query: `releaseType`, `slug`, optional `trackSlug`, `albumSlug`, `legacyVideo`, `legacyImage`
- Or: `videoFolder`, `imageFolder` (entity folders from DB)
- Default: `302` redirect to CDN URL; `X-Media-Type: video|image`
- `?meta=1` or `?format=json`: `{ type, url, key, source }`

**Consumers updated (data source only, no layout changes):**

| File | Change |
|------|--------|
| `src/lib/media/canonical-catalog.js` | `visual`, `cover`, `video` → `visualDiscoveryUrl()`; `coverArtType` for singles |
| `src/lib/media-urls.js` | `catalogVisualMediaUrl()` |
| `src/components/home/catalogMedia.js` | Resolves `visual` through visual API |
| `src/lib/music-playback.js` | Prefers `visual` for cover URL |
| `src/components/collectors-cards/collectorCardCatalog.js` | Love Hz card uses visual API (was `loop.mp4`) |

**Existing:** `GET /api/media/preview` — preview / artwork / video-by-folder; uses resolver aliases.

## Preview fallbacks

- Canonical: `previews/{type}/{slug}/` via `resolvePreviewPath` + `resolvePreviewFile`
- Legacy: `preview_legacy` on catalog rows → `?legacy=` on `/api/media/preview`
- `previewDiscoveryUrl()` unchanged; catalog `preview` field still points to preview API

## Migrations

```bash
# Apply in order (local / hosted Supabase)
supabase db push
# or
supabase migration up
```

| Migration | Purpose |
|-----------|---------|
| `20260529130000_entity_folder_paths.sql` | Initial folder-only product/track paths |
| `20260529140000_multimedia_entity_folders.sql` | Strip any remaining filenames; normalize single/feature prefixes |

## Build

`npm run build` — **passed** (Next.js 16.2.4). New route listed: `/api/media/visual`.

## Playback / visual validation checklist

- [ ] Single with R2 video: card/ambient shows motion (`coverArtType: video`, visual API → mp4)
- [ ] Single without video, with image: visual API → jpg; no blank card
- [ ] Single without both: palette fallback via `useCoverPalette` (no crash)
- [ ] Preview missing: full stream still works for entitled users; preview button silent or error surfaced
- [ ] No audio in entity folder: playback blocked (expected)
- [ ] Feature / album artwork via `images/mixtapes-and-eps/{slug}/`
- [ ] iOS Safari: tap play → audio audible; visual redirect cache headers OK
- [ ] `/api/media/visual?meta=1&releaseType=single&slug=hour-glass` returns JSON type

## Remaining stale filename refs (intentional or out of scope)

| Location | Notes |
|----------|-------|
| `canonical-catalog.js` | `preview_legacy` flat keys (fallback after canonical miss) |
| `canonical-paths.js` | `legacyCoverPublicPath`, `legacyVideoPublicPath` for migration |
| `src/app/page.js` | Static merch/YouTube/exclusive covers; `videos/A2B.mp4` ambient (protected page — not changed) |
| `src/lib/commerce/catalog.js` | Merch/vinyl static `/images/` paths |
| `src/app/api/printful/products/route.js` | Merch mock covers |
| Vault UI SFX | `/audio/vault/*.mp3` (non-catalog) |

## Unresolved missing objects

Requires live R2 listing (not run in CI):

- Objects must exist **inside** entity folders (any filename matching extension priority).
- Legacy flat keys still used when folder discovery returns null during migration window.

## Mobile notes

- Visual/preview APIs use `302` + `Cache-Control: public, max-age=300` — friendly to Safari redirect chains.
- Single canonical audio path unchanged; no second `<audio>` element.
- `coverArtType: video` on singles may use `<video>` with API URL; if only image exists, redirect serves image (Safari may show first frame or fall back to palette — test on device).

## Top 3 risks

1. **Redirect-based video tags** — Singles marked `coverArtType: video` hit `/api/media/visual`; if R2 has only images, `<video>` behavior varies by browser; palette still applies when cover empty.
2. **R2 ListObjects latency** — Discovery cache TTL 60s; cold folder listing on first card paint may add ~100–300ms per unique slug.
3. **DB path drift** — Products with non-canonical `storage_path` prefixes need migration `20260529140000`; wrong folder → playback 404 until admin sync.
