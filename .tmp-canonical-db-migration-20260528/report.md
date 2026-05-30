# Canonical DB Migration — 2026-05-28

## Prompt requirements (executed)

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Slug normalization (`tbh.h` → `tbh`, `love-hz` → `love-hz-vol-1`, catalog `album_slug` fixes) | Done in migration |
| 2 | Title normalization (exact canonical strings, ASCII apostrophes) | Done in migration + existing `canonical-catalog.js` |
| 3 | Release metadata upsert (`slug`, `title`, `release_type` in metadata, `release_category` for EP/Mixtape) | Done in migration |
| 4 | Track metadata upsert (`catalog_tracks`: slug, title, track_number, album_slug, preview_path) | Done in migration |
| 5 | Entity-folder storage paths (no filenames; `digital-assets/` stripped in `products.storage_path` per app convention) | Done in migration |
| 6 | Transaction + rollback comments | `BEGIN`/`COMMIT` + footer comments |
| 7 | `npm run build` | Pass |
| 8 | Report + zip | This folder + `~/Downloads/canonical-db-migration-20260528.zip` |

**Not done (per scope):** commit, push, deploy — prompt did not request deployment.

**Not duplicated:** `20260529120000`, `20260529130000`, `20260529140000` left intact; new migration `20260529150000` layers normalization on top.

## Migration files

| File | Role |
|------|------|
| `supabase/migrations/20260529150000_canonical_metadata_normalization.sql` | **New** — slug/title/path/metadata normalization |
| `supabase/migrations/20260529120000_canonical_media_metadata.sql` | Existing — schema + initial seed |
| `supabase/migrations/20260529130000_entity_folder_paths.sql` | Existing — folder-only paths |
| `supabase/migrations/20260529140000_multimedia_entity_folders.sql` | Existing — filename strip patch |

## App alignment (minimal)

| File | Change |
|------|--------|
| `src/lib/media/canonical-catalog.js` | `metadata.release_type` folder segment; album `video_path`; track `preview_path` in seed rows |

## Run instructions

```bash
cd /Users/recharge/artist-platform

# Apply all pending migrations (including 20260529150000)
supabase db push

# Or run the single file in Supabase SQL Editor (paste migration contents)

# Optional: re-seed from JS catalog (requires .env.local service role)
node scripts/seed-products.mjs
```

### Post-migration verification

```sql
-- Slugs
SELECT slug, title, display_title, storage_path, metadata->>'release_type' AS release_type
FROM products
WHERE slug IN ('tbh', 'tbh.h', 'love-hz', 'love-hz-vol-1', 'hour-glass', 'i-dont-believe-you');

-- Track count
SELECT album_slug, count(*) FROM catalog_tracks
WHERE album_slug IN ('love-hz-vol-1', 'ad', 'tbh')
GROUP BY album_slug;

-- Sample paths (entity folders, trailing slash)
SELECT slug, storage_path, preview_path FROM catalog_tracks
WHERE album_slug = 'tbh' ORDER BY track_number LIMIT 3;
```

Expected:

- No row with `slug = 'tbh.h'`; `tbh` title is `T.B.H`
- 10 + 11 + 9 = 30 `catalog_tracks` rows for the three albums
- Singles/features: `storage_path` like `singles/hour-glass/` (no filename)
- Album tracks: `mixtapes-and-eps/tbh/01-glass-full/` and `previews/mixtapes-and-eps/tbh/01-glass-full/`

## Path conventions

| Layer | `storage_path` in DB | Full R2 audio key (runtime) |
|-------|----------------------|-------------------------------|
| Single | `singles/{slug}/` | `digital-assets/singles/{slug}/…` |
| Feature | `features/{slug}/` | `digital-assets/features/{slug}/…` |
| Album track | `mixtapes-and-eps/{album}/{track}/` | `digital-assets/mixtapes-and-eps/…` |
| Artwork | `images/{type}/{slug}/` | as stored |
| Preview | `previews/{type}/{slug}/` | as stored |
| Video | `videos/mixtapes-and-eps/{slug}/` | as stored |

`metadata.release_type`: `singles` | `features` | `mixtapes-and-eps` (R2 folder segment; matches `normalizeReleaseType`).

`metadata.release_category`: `single` | `feature` | `EP` | `Mixtape`.

## Build

```
npm run build  → exit 0
```

## Commit

Not created (user/prompt did not request commit).

## Risks

1. **Library entitlements** tied to old `love-hz` or `tbh.h` product slugs may need manual FK updates if those slugs existed in production purchases.
2. **R2 objects** must live inside entity folders; DB paths do not rename bucket keys.
3. Migration timestamp `20260529150000` sorts before `20260601*` migrations — correct for catalog work bundled with May 29 canonical batch.
