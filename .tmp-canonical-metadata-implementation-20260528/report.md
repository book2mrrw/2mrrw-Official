# Canonical Media Metadata Implementation — 2026-05-28

## Summary

Database and `src/lib/media/canonical-catalog.js` are now the authoritative metadata source for singles, features, EPs, and mixtapes. R2 paths follow the nested canonical layout (`digital-assets/singles|features|mixtapes-and-eps/...`). Titles are exact strings from the spec — never derived from slugs in UI.

## Files changed

| File | Change |
|------|--------|
| `src/lib/media/canonical-paths.js` | **New** — `resolveStoragePath`, `resolveArtworkPath`, `resolvePreviewPath`, `resolveVideoPath` |
| `src/lib/media/canonical-catalog.js` | **New** — all canonical releases, tracks, storefront helpers, product seed rows |
| `supabase/migrations/20260529120000_canonical_media_metadata.sql` | **New** — schema extensions, products upsert, `catalog_tracks` seed |
| `src/lib/commerce/catalog.js` | Digital rows sourced from canonical catalog; features use `features/` path |
| `src/lib/music-playback.js` | `mergeCanonicalMetadata` on items; album track titles from canonical records |
| `src/lib/playback/resolve-playback-key.js` | Falls back to `catalog_tracks.storage_path` when `trackSlug` option passed |
| `src/app/page.js` | Inline catalog replaced with canonical imports (hero shell unchanged) |
| `scripts/seed-products.mjs` | Seeds extended columns + `catalog_tracks` |

## Migration instructions

```bash
# Apply migration (Supabase CLI or SQL editor)
supabase db push
# or run supabase/migrations/20260529120000_canonical_media_metadata.sql manually

# Optional: re-seed from JS catalog (requires service role in .env.local)
node scripts/seed-products.mjs
```

### Schema additions

- **products**: `release_date`, `display_title`, `artwork_path`, `video_path`, `album_slug`
- **catalog_tracks**: per-album track rows with `track_number`, `slug`, `title`, `storage_path`

### Slug migration

- `love-hz` → `love-hz-vol-1` (SQL + `CANONICAL_SLUG_ALIASES` for runtime compat)

### Feature path fix

- `i-dont-believe-you`, `2-heavy` storage paths moved from `digital-assets/singles/` → `digital-assets/features/`

## Canonical path matrix

| Type | Audio | Artwork | Preview | Video |
|------|-------|---------|---------|-------|
| Single | `digital-assets/singles/{slug}/audio.wav` | `images/singles/{slug}/artwork.jpg` | legacy `previews/{slug}-preview.mp3` stored explicitly | `videos/singles/{slug}/loop.mp4` |
| Feature | `digital-assets/features/{slug}/audio.wav` | `images/features/{slug}/artwork.jpg` | `previews/{slug}-preview.wav` | — |
| EP/Mixtape track | `digital-assets/mixtapes-and-eps/{album}/{track}/audio.wav` | `images/mixtapes-and-eps/{album}/artwork.jpg` | — | — |

Legacy public paths (`/images/singles/hourglass.jpg`, `/audio/previews/...`) remain for CDN display until R2 objects are renamed to canonical keys.

## Ordering

- **Singles**: `release_date DESC` (Hour Glass → Turnt Me 2 Dis → W.2.D → ArTiFiCiAL)
- **Album tracks**: `track_number ASC` in `catalog_tracks` and storefront album objects

## Verification checklist

- [ ] Run migration on staging Supabase
- [ ] `SELECT slug, title, storage_path FROM products WHERE slug IN ('hour-glass','i-dont-believe-you','love-hz-vol-1');`
- [ ] Features show `features/` not `singles/` in `storage_path`
- [ ] `SELECT count(*) FROM catalog_tracks;` → 30 rows
- [ ] Storefront singles show **ArTiFiCiAL** not "Artificial"
- [ ] Love Hz modal shows 10 tracks with exact titles (Roll Call … Turnt Me 2 Dis)
- [ ] T.B.H shows **2Late?** and **LEFT (interlude)**
- [ ] `(A.D)` shows **2MRRW: (A.D)** title and 11 tracks
- [ ] Entitled stream for single: `/api/library/stream?slug=hour-glass` → signed R2 key ending in `digital-assets/singles/hour-glass/audio.wav`
- [ ] Feature stream resolves `digital-assets/features/i-dont-believe-you/audio.wav`
- [ ] `npm run build` passes

## Top risks

1. **R2 object keys vs canonical paths** — DB now stores canonical nested paths; some R2 objects may still use legacy flat names (`hourglass-preview.mp3`, `images/singles/hourglass.jpg`). Preview/artwork legacy paths are preserved in storefront cards until R2 is aligned.
2. **Album per-track streaming** — `/api/library/stream` still keys on album product slug; `resolvePlaybackKey(admin, slug, { trackSlug })` supports `catalog_tracks` but stream route does not yet pass `track` query param. Album playback may still resolve first track only until stream route is extended.
3. **`love-hz` slug rename** — existing purchases/library rows tied to old slug need entitlement parity check after migration.
4. **Singles use `.wav` in canonical spec** — R2 may still host `.mp3` for some singles; playback 404 until bucket objects match `audio.wav` keys or products rows are adjusted to match uploaded format.

## Build

`npm run build` — **passed** (Next.js 16.2.4)
