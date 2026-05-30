# Media path fix — all four release types (2026-05-28)

**Scope:** Extend 2026-05-28 singles entity-folder path fix to `features`, `albums`, and `mixtapes-and-eps`. Read-path only — no `page.js`, migrations, or R2 uploads.

---

## 1. Prompt requirements (summary)

| Requirement | Status |
|-------------|--------|
| `PREVIEW_ROOT = "audio"` (verify) | ✓ Already set |
| `legacyCoverPublicPath` / `legacyVideoPublicPath` include `{releaseSlug}/` for all types | ✓ |
| `legacyPreviewPublicPath` builds `audio/{type}/{slug}/{stem}-preview.{ext}` | ✓ |
| Feature previews stay `.wav` | ✓ |
| `CANONICAL_CATALOG` per release type with folder + legacy helpers | ✓ Added |
| `mergeCanonicalMetadata` prefers canonical discovery over inline flat paths | ✓ Extended |
| `withR2CatalogMedia` merges for all types (not singles-only) | ✓ Already unconditional |
| `media-urls.js` passes `/api/media/*` and `audio/` CDN keys | ✓ Verified (no change needed) |
| `npm run build` | ✓ Pass |

---

## 2. Root cause (features / albums / mixtapes)

Same structural bug as pre-fix singles:

| Helper | Broken behavior |
|--------|-----------------|
| `legacyCoverPublicPath` | Features: flat `images/features/{slug}.jpg`; mixtapes: flat `images/albums/{slug}.jpg` |
| `legacyVideoPublicPath` | Singles-only signature; no `releaseType` |
| Feature `preview_legacy` | Flat `previews/{slug}-preview.wav` |
| Album `legacy_cover` | Flat `/images/albums/{stem}.jpg` without entity folder |

---

## 3. Fixes applied

### `canonical-paths.js`

- `legacyCoverPublicPath(releaseType, slug, stem, ext)` → `/images/{folder}/{slug}/{stem}.{ext}` for all folders.
- `legacyVideoPublicPath(releaseType, slug, stem, ext)` → `/videos/{folder}/{slug}/{stem}.{ext}`.
- `legacyPreviewPublicPath(releaseType, slug, stem, ext)` → `audio/{folder}/{slug}/{stem}-preview.{ext}` with per-type default ext (features → wav).
- `normalizeLegacyPreviewPath(previewR2Key)` — migration normalizer (old flat `previews/` keys).

### `canonical-catalog.js`

- `CANONICAL_CATALOG` map for `singles`, `features`, `albums`, `mixtapes-and-eps`.
- Features: entity-folder `preview_legacy` under `audio/features/{slug}/`.
- Albums/EPs/mixtapes: `legacy_cover_stem` instead of flat `legacy_cover`; covers resolve via entity folder.
- `enrichRelease` builds `preview_legacy` when omitted.
- `mergeCanonicalMetadata` attaches `cover_folder`, `preview_folder`, `*_legacy` from catalog for all canonical slugs.

### Unchanged (verified)

- `storage-domains.js` — `PREVIEW_ROOT = "audio"`.
- `r2-catalog-media.js` — `mergeCanonicalMetadata` before CDN resolution (all types).
- `media-urls.js` — discovery API pass-through from singles fix.

---

## 4. Verification matrix (expected keys)

| Release type | Cover legacy | Preview legacy |
|--------------|--------------|----------------|
| singles | `images/singles/{slug}/{stem}.jpg` | `audio/singles/{slug}/{stem}-preview.mp3` |
| features | `images/features/{slug}/{stem}.jpg` | `audio/features/{slug}/{stem}-preview.wav` |
| albums | `images/albums/{slug}/{stem}.jpeg` | `audio/albums/{slug}/{stem}-preview.mp3` |
| mixtapes-and-eps | `images/mixtapes-and-eps/{slug}/{stem}.jpeg` | `audio/mixtapes-and-eps/{slug}/{stem}-preview.mp3` |

No runtime catalog path should start with `previews/` after enrichment (normalizer retains bucket fallback for stale keys).

---

## 5. Build

```
npm run build — ✓ success (Next.js 16.2.4)
```

---

## 6. Files changed

| File | Change |
|------|--------|
| `src/lib/media/constants/storage-domains.js` | Verified only |
| `src/lib/media/canonical-paths.js` | Generalized legacy path builders + preview normalizer |
| `src/lib/media/canonical-catalog.js` | `CANONICAL_CATALOG`, feature/album legacy keys, merge enrichment |
| `src/lib/media/r2-catalog-media.js` | Verified only |
| `src/lib/media-urls.js` | Verified only |

---

## 7. Remaining risks

- R2 objects must exist under entity folders; discovery API still falls back via `normalizeLegacyPreviewPath` for flat `previews/` bucket keys.
- Canonical albums in storefront use `mixtapes-and-eps` folder (EP/mixtape `release_type`), not `albums/` — matches `normalizeReleaseType`.
- Supabase `storage_path` rows not updated (out of scope).
