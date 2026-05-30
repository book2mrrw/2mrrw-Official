# 03 — Database paths & mappings

## `products.storage_path` (code seed)

| Slug | `PRODUCT_CATALOG` / migration | `normalizePlaybackR2Key` output |
|------|------------------------------|--------------------------------|
| hour-glass, w2d, artificial, turnt-me-2-dis | `singles/{slug}/audio.mp3` | `digital-assets/singles/{slug}/audio.mp3` |
| i-dont-believe-you, 2-heavy | `digital-assets/singles/{slug}/audio.wav` | unchanged (already prefixed) |

**Migration:** `supabase/migrations/20260528071100_backfill_feature_storage_paths.sql` backfills feature rows when `storage_path` null.

## Albums

- `PRODUCT_CATALOG` album rows (`tbh`, `ad`, `love-hz`) have **no** `storage_path`.
- `resolvePlaybackKey` (`src/lib/playback/resolve-playback-key.js`) falls through:
  1. `products.storage_path`
  2. `content_id` + `content_type` → `tracks` → `release_media` / `media_assets`
  3. Else **null** → stream API **404** `"No downloadable asset"`

## Control System schema (migrations)

- `media_assets.storage_path`, `release_media` link table (`008_vault_entitlement_persistence.sql`)
- Vault: `preview_storage_path`, `media_storage_path`

## Stale / risk mappings

| Risk | Detail |
|------|--------|
| DB not seeded | Slugs in UI but missing `products` row → stream 404 |
| Feature `storage_path` null | Fixed by migration; drift if seed skipped |
| Album per-track | Inline track titles ≠ product slugs; stream may use album slug only |
| Capital paths in bucket | Code never uses `Singles/`; objects must be lowercase `singles/` |

## Scripts

- `scripts/migrate-r2-bucket.mjs` — canonical key list for bucket copy verify
- No runtime normalize script beyond `normalizePlaybackR2Key` in app code
