# Path Resolution Matrix — slug → expected R2 key → code path

**Public CDN base:** `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` (from `.env.example` / `R2_PUBLIC_CDN_FALLBACK`)

**Signed full-track base:** S3 presigned GET on bucket `2mrrw-media` via `createR2SignedGetUrl(key)` — same object keys as below, not served from public r2.dev unless object is public.

**Normalization:** `normalizePlaybackR2Key(storage_path)` in `src/lib/playback/normalize-r2-key.js` — prefixes `digital-assets/` unless path already starts with `digital-assets/` or `protected-media/`.

---

## Singles (catalog previews — public)

| Slug | UI preview path | Resolved public URL | Code path |
|------|-----------------|---------------------|-----------|
| `hour-glass` | `/audio/previews/hourglass-preview.mp3` | `{CDN}/previews/hourglass-preview.mp3` | `page.js` INLINE_SINGLES → `withR2CatalogMedia` → `catalogPreviewAudioUrl` (`src/lib/media-urls.js`) |
| `w2d` | `/audio/previews/w2d-preview.mp3` | `{CDN}/previews/w2d-preview.mp3` | Same |
| `artificial` | `/audio/previews/artificial-preview.mp3` | `{CDN}/previews/artificial-preview.mp3` | Same |
| `turnt-me-2-dis` | `/audio/previews/turntme2dis-preview.mp3` | `{CDN}/previews/turntme2dis-preview.mp3` | Same |

**Live probe:** all return **200/206** with `Access-Control-Allow-Origin` for `https://www.2mrrw.com` and `https://2mrrw.com`.

---

## Singles (entitled full stream — signed)

| Slug | `products.storage_path` (seed) | Final signed R2 key | Code path |
|------|----------------------------------|---------------------|-----------|
| `hour-glass` | `singles/hour-glass/audio.mp3` | `digital-assets/singles/hour-glass/audio.mp3` | `PRODUCT_CATALOG` → DB → `resolvePlaybackKey` → `normalizePlaybackR2Key` → `/api/library/stream` → `createR2SignedGetUrl` |
| `w2d` | `singles/w2d/audio.mp3` | `digital-assets/singles/w2d/audio.mp3` | Same |
| `artificial` | `singles/artificial/audio.mp3` | `digital-assets/singles/artificial/audio.mp3` | Same |
| `turnt-me-2-dis` | `singles/turnt-me-2-dis/audio.mp3` | `digital-assets/singles/turnt-me-2-dis/audio.mp3` | Same |

**Client playback URL (entitled):** `/api/library/stream?slug={slug}&redirect=1` — `libraryStreamRedirectSrc` in `src/lib/music-access.js`.

**Live probe (public CDN, same key):** `digital-assets/singles/hour-glass/audio.mp3` → **206** + CORS headers. Capitalized `digital-assets/Singles/...` → **404**.

---

## Features (preview public + full signed)

| Slug | Preview path | Public preview URL | `storage_path` (seed + migration) | Signed key |
|------|--------------|-------------------|-----------------------------------|------------|
| `i-dont-believe-you` | `/audio/previews/i-dont-believe-you-preview.wav` | `{CDN}/previews/i-dont-believe-you-preview.wav` | `digital-assets/singles/i-dont-believe-you/audio.wav` | same (already prefixed) |
| `2-heavy` | `/audio/previews/2-heavy-preview.wav` | `{CDN}/previews/2-heavy-preview.wav` | `digital-assets/singles/2-heavy/audio.wav` | same |

**Code path:** `src/lib/commerce/catalog.js`, backfill `supabase/migrations/20260528071100_backfill_feature_storage_paths.sql`, `scripts/migrate-r2-bucket.mjs` keys 24–25.

**Note:** Features use **`digital-assets/singles/`** (lowercase), not `digital-assets/Features/`. Live probes confirm lowercase masters exist; `Features/` capital path **404**.

---

## Albums (no per-track storage_path in seed catalog)

| Slug | Preview | Full stream key | Code path |
|------|---------|-----------------|-----------|
| `tbh` | None in INLINE_ALBUMS | **None in `PRODUCT_CATALOG`** — requires Control System `media_assets` / `products.content_id` + `tracks` via `resolvePlaybackKey` | `resolvePlaybackKey` → `releasePrimaryAudioPath` / `trackFullAudioPath` |
| `ad` | None | Same | Same |
| `love-hz` | None | Same | Same |

Album modal playback uses `playAlbumTracks` → `resolvePlaybackSrc` with album slug or track slug if in catalog lookup (`src/lib/music-playback.js`).

**Risk:** If DB has no `storage_path` and no linked `media_assets`, `/api/library/stream` returns **404** `"No downloadable asset for this item"`.

---

## Vault / access token / control sync

| Entry | Path pattern | Key builder |
|-------|--------------|-------------|
| Gift/access token | `product.storage_path` | `buildR2Key(DIGITAL_ASSETS, path)` — `src/app/api/access/[token]/route.js` |
| Vault media | `preview_storage_path` / `media_storage_path` | `buildR2Key(DIGITAL_ASSETS, storagePath)` — `src/app/api/vault/media/route.js` |
| Control sync | `row.storage_path` / `canonical_media_path` | `normalizeStoragePathForStorefront` — `src/app/api/admin/sync/catalog/route.js` |

---

## Stated vs actual R2 folder layout

| Stated (user spec) | In codebase / live CDN | Match? |
|--------------------|------------------------|--------|
| `digital-assets/Albums/` | Not referenced in `src/`; album images at `images/albums/` | **Unverified** for masters |
| `digital-assets/Features/` | Code uses `digital-assets/singles/` for feature WAVs | **Mismatch** — capital path 404 on CDN |
| `digital-assets/Singles/` | Code + CDN use `digital-assets/singles/` (lowercase) | **Mismatch** — capital path 404 |
| `digital-assets/Mixtapes & EPs/` | No references in `src/`; URL-encoded probe inconclusive (416 on empty range) | **Unverified** |

**Conclusion:** Storefront signing and migration scripts align with **lowercase** `digital-assets/singles/`. Do not normalize paths to capitalized folder names without re-uploading objects or adding dual-key lookup.

---

## `/api/library/stream` failure matrix

| HTTP | When | Layer |
|------|------|-------|
| **400** | Missing `slug` | API validation |
| **401** | No fan/guest session | Auth (`getFanSessionUser` / `getGuestUser`) |
| **403** | `userCanStreamProduct` false | Entitlements |
| **404** | Unknown slug or `resolvePlaybackKey` null | DB / `storage_path` / `media_assets` |
| **500** | R2 signing error, Supabase error | Server / env (`CLOUDFLARE_R2_*`) |

**Signed URL client checks** (`stream-client.js`): after JSON `url`, **HEAD** signed URL; expects `audio/*` or `application/octet-stream`. Failure → `SIGNED_STREAM_UNREACHABLE` / `SIGNED_STREAM_INVALID_CONTENT_TYPE`.
