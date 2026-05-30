# Release type normalization audit — 2026-05-28

Read-only audit of `releaseType` / `release_type` / `product_type` handling across the media pipeline. Scope: `src/` + `scripts/verify-r2-entity-folders.mjs`. No playback/auth/queue changes.

---

## 1. Canonical normalization exists? **Yes**

| Layer | Path |
|-------|------|
| Aliases + allowed segments | `src/lib/media/constants/release-types.js` |
| Normalizer | `src/lib/media/utils/normalize-release-type.js` |
| Re-export | `src/lib/media/normalize-release-type.js` |
| R2 path builders | `src/lib/media/canonical-paths.js` (`releaseFolder()` → `normalizeReleaseType`) |

**Canonical R2 folder segments (code + R2 bucket):**

| Segment | Notes |
|---------|--------|
| `singles` | Flat entity folders |
| `features` | Flat entity folders (audio may also exist under `singles/` — see §4) |
| `mixtapes-and-eps` | Nested `{project}/{track}/` for audio, preview, video, images |
| `albums` | Same nesting rules as mixtapes; reserved for future true albums (no objects under `digital-assets/albums/` in R2 verify) |

**User spec vs code:** User wrote `mixtape-and-eps` (singular *mixtape*). **R2 and all path builders use `mixtapes-and-eps` (plural).** There is **no** `mixtape-and-eps` string anywhere in `src/`. Incoming `mixtape-and-eps` or `mixtape_ep` today fall through to default **`singles`** (unknown alias).

### Alias map (`RELEASE_TYPE_ALIASES`)

| Input | Output |
|-------|--------|
| `single`, `singles` | `singles` |
| `feature`, `features` | `features` |
| `album`, `albums` | `albums` |
| `ep`, `mixtape`, `mixtapes`, `mixtapes-and-eps` | `mixtapes-and-eps` |
| unknown / empty | `singles` |

---

## 2. Do all resolvers use it?

| File | Uses `normalizeReleaseType`? | Notes |
|------|------------------------------|--------|
| `canonical-paths.js` | **Y** | All `resolve*Path` + `visualDiscoveryUrl` |
| `entity-resolver.js` | **Y** | `resolveVisualMedia` |
| `canonical-catalog.js` | **Y** (indirect) | Passes raw `release_type` into `resolve*Path` |
| `media-availability.js` | **Y** | `inferReleaseType` + path builders |
| `admin-media-diagnostics.js` | **Y** | |
| `catalogMedia.js` | **Y** | Placeholder only |
| `api/media/visual/route.js` | **Y** | Query `releaseType` |
| `api/media/preview/route.js` | **N** | Expects pre-built `folder=` (built upstream via canonical paths) |
| `api/library/stream/route.js` | **Partial** | Primary key from DB `storage_path`; preview fallback uses normalizer |
| `resolve-playback-key.js` | **Partial** | DB path authoritative; preview fallback uses normalizer |
| `music-playback.js` / `media-urls.js` | **N** | URL helpers only; paths come from catalog |
| `releases.js` | **N** | Display partition (`single`/`ep`/`album` UI types, not R2 segments) |
| `scripts/verify-r2-entity-folders.mjs` | **N** | **Duplicate** local `RELEASE_FOLDER` map (drift risk; mirrors ep/mixtape → `mixtapes-and-eps`) |

---

## 3. Incoming value trace (CMS / catalog / Supabase)

| Source | Typical values | Normalized segment |
|--------|----------------|-------------------|
| `canonical-catalog.js` | `release_type`: `single`, `feature`, `ep`, `mixtape` | via `resolve*Path` |
| `canonical-catalog` product rows | `product_type`: `single`, `feature`, `album`; metadata `release_category`: `single`, `feature`, `EP`, `Mixtape` | album rows use `ep`/`mixtape` in metadata for path build |
| Supabase migration `20260529120000_*` | `product_type` `album`; `storage_path` `mixtapes-and-eps/...` | DB path is already canonical; no re-normalize on read |
| `page.js` (protected baseline) | `type`: `single`, `feature`, `album` | Legacy `/images/*` public paths; merged via `mergeCanonicalMetadata` for playback |
| `product_type` (commerce) | `single`, `feature`, `album`, `vinyl`, `merch`, `vault`, `bundle` | Commerce only unless passed to `normalizeReleaseType` |
| `content_type` (products) | `track`, release ids | Used in `resolve-playback-key` preview fallback as `normalizeReleaseType(content_type)` — **`album` → `albums`** if `release_category` missing |
| `latest-single` | — | **Not found** in repo |

---

## 4. Path construction matrix

Pattern: `{domain}/{releaseType}/{releaseSlug}/...` where domain ∈ `digital-assets`, `previews`, `images`, `videos`.

| File / entry | Input `releaseType` | Normalized? | Output folder segment | Bypass? |
|--------------|---------------------|-------------|------------------------|---------|
| `resolveStoragePath` | any | Y | `singles` / `features` / `mixtapes-and-eps` / `albums` | No |
| `resolvePreviewPath` | any | Y | same | No |
| `resolveArtworkPath` | any | Y | same | No |
| `resolveVideoPath` | any | Y | same | No |
| `visualDiscoveryUrl` | any | Y | query `releaseType=` canonical segment | No |
| `legacyCoverPublicPath` | any | Y | **public** `/images/singles|features|albums/` (not R2 keys) | Legacy display |
| `legacyVideoPublicPath` | n/a | n/a | `/videos/singles/{slug}.mp4` | Legacy |
| `resolve-playback-key` | DB `storage_path` | **Bypass** | Uses DB/catalog_tracks path as entity folder | Yes — intentional |
| `resolve-playback-key` preview fallback | `metadata.release_category` \|\| `content_type` | Y | Can mis-resolve `album` → `albums` if category absent | Conditional bypass risk |
| `api/media/preview` | `folder` query | **Bypass** | Caller-supplied folder | Yes — must be canonical |
| `api/media/visual` | `videoFolder` / `imageFolder` | **Bypass** | Caller-supplied folders | Yes — optional override |
| `page.js` catalog arrays | `type` single/feature/album | **Bypass** | Hardcoded `/images/`, `/videos/`, `/audio/previews/` | Yes — baseline UI |
| `collectorCardCatalog.js` | `"ep"`, `"single"` in `visualDiscoveryUrl` | Y | API builds `videos|images/...` | No |
| Feature audio discovery | `features/` path | Y + **fallback** | Tries `features/` then `singles/` (`media-availability`, `resolve-playback-key`) | Workaround for split R2 layout |

### Example final keys (after normalization)

| Release | Input | Example key |
|---------|-------|-------------|
| Hour Glass single | `single` | `videos/singles/hour-glass/` |
| IDBU feature | `feature` | `videos/features/i-dont-believe-you/` |
| Love Hz track | `ep` + album slug | `digital-assets/mixtapes-and-eps/love-hz-vol-1/09-hour-glass/` |
| TBH project art | `mixtape` | `images/mixtapes-and-eps/tbh/` |

---

## 5. Inconsistencies found

| Issue | Severity | Detail |
|-------|----------|--------|
| **`mixtape-and-eps` vs `mixtapes-and-eps`** | Doc / future input | R2 + code canonical = **`mixtapes-and-eps`**. User spec singular form is **not** aliased; would normalize to `singles`. |
| **`album` → `albums` vs catalog on `mixtapes-and-eps`** | Latent | Storefront mixtapes use `product_type: album` but R2 lives under `mixtapes-and-eps`. Safe when DB `storage_path` or `release_category` (`EP`/`Mixtape`) is present. Risk only on preview fallback with `content_type=album` and no category. |
| **`features` vs `feature` in visual API** | **Not a bug** | Route calls `normalizeReleaseType`; `feature` → `features`. R2 verify shows `videos/features/`, `images/features/` present. |
| **Feature masters under `singles/`** | Intentional | `resolve-playback-key` + `media-availability` retry `features/` → `singles/` for audio only. R2 also has `digital-assets/features/` for previews/images. |
| **verify-r2 script duplicate map** | Maintenance | Does not import `normalize-release-type.js`; includes `album: albums` same as production aliases. |
| **`digital-assets/albums/`** | Unused | Listed in constants; no verified R2 objects for current catalog. |

---

## 6. Minimal fix applied

**None.** No single file was found bypassing normalization in a way that currently produces wrong R2 keys for canonical catalog + migrated Supabase rows. DB `storage_path` values already use `mixtapes-and-eps/...`.

**Recommended follow-ups (out of scope unless requested):**

1. Add aliases: `mixtape-and-eps`, `mixtape_ep` → `mixtapes-and-eps` in `release-types.js` only.
2. In `resolve-playback-key` preview fallback, prefer `normalizeReleaseType(metadata.release_category || metadata.release_type || product_type)` and map storefront `album` products to `ep`/`mixtape` via canonical catalog slug lookup.
3. Deduplicate `RELEASE_FOLDER` in `verify-r2-entity-folders.mjs` to import from `constants/release-types.js`.

---

## 7. Summary checklist

| Question | Answer |
|----------|--------|
| Canonical normalization exists? | **Y** |
| All resolvers use it? | **Mostly Y** — preview/stream use DB paths by design; preview route uses pre-built folders |
| Bypass count (meaningful) | **~4 classes**: (1) DB `storage_path`, (2) preview/visual `folder=` params, (3) `page.js` legacy public URLs, (4) preview fallback when only `content_type=album` |
| Critical mismatch (`mixtapes` naming)? | **Naming doc only** — R2 uses **`mixtapes-and-eps`**; code aligned; user singular variant not aliased |
| Build run? | **No** (no code change) |
| Commit? | **No** |

---

## References

- R2 probe: `scripts/verify-r2-entity-folders.mjs`, `.tmp-final-playback-validation-20260528/r2-verify.json`
- Migration paths: `supabase/migrations/20260529120000_canonical_media_metadata.sql`
