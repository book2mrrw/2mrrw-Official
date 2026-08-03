# Cloudflare R2 Migration Readiness — Master Read-Only Audit

**Status key:** **EXISTS** | **MISSING** | **PARTIAL**

**R2 readiness headline:** **MISSING** — no Cloudflare R2/S3 client, env vars, or URL patterns in either repo. Storage is **Supabase Storage** (two bucket names) plus **Next.js `public/`** static files.

---

## 1. CURRENT MEDIA STORAGE LOCATION

### **PARTIAL** — split across local `public/`, Supabase, and hardcoded fallbacks

#### artist-platform — `public/` (only on-disk media repo)

| Format | Files present |
|--------|----------------|
| **Audio .mp3** | `/Users/recharge/artist-platform/public/audio/full/{hourglass,artificial,turnt,w2d}.mp3`, `public/audio/previews/{hourglass,artificial,turntme2dis,w2d}-preview.mp3` |
| **Audio .wav** | `public/audio/full/{2-heavy,i-dont-believe-you}.wav`, `public/audio/previews/{2-heavy,i-dont-believe-you}-preview.wav` |
| **Video .mp4** | `public/videos/A2B.mp4`, `public/videos/singles/{hourglass,artificial,w2d,turntme2dis}.mp4` |
| **Video .zip** | `public/videos/A2B.mp4.zip` |
| **Images .jpg** | `public/images/singles/{hourglass,w2d,artificial,turnt}.jpg`, `albums/{tbh,ad,lovehz}.jpg`, `features/{2heavy,idbu}.jpg` |
| **SVG** | `public/{file,globe,next,vercel,window}.svg` |

**MISSING on disk (referenced in code/catalog):** `.aiff .aif .flac .ogg .m4a .opus`, all video except `.mp4`, `.m3u8 .ts`, `.png .gif .webp .avif`, `.pdf`, merch images (`/images/merch/*`), vault SFX mp3s (`/audio/vault/*.mp3`), ambient tab mp3s (`/audio/ambient/*.mp3`), `assets/`, `static/` dirs (none exist).

#### 2MRRW-Control-System — `public/`, `assets/`, `static/`

**MISSING** — no `public/`, `assets/`, or `static/` media trees; no binary media files in repo (only TypeScript matched `*.ts` in an overly broad find).

#### Supabase Storage buckets

| Bucket | Repo | Access | Signed URL TTL |
|--------|------|--------|----------------|
| **`digital-assets`** | artist-platform | Private (commented migration) | 900s (`access`), 3600s (`library/stream`, `vault/media`) |
| **`protected-media`** | Control System | Private (documented) | 300s read; 300s upload intent |

**Gap:** Two bucket names, no unified abstraction — `src/db/schema-docs/frontend-integration-compatibility.md` explicitly calls this out.

#### Hardcoded / external URLs

| Source | Examples |
|--------|----------|
| artist-platform `page.js` | YouTube embed/thumbnails, PayPal, social links |
| Control System | `https://artist-platform-silk.vercel.app` + `/images/*`, `/videos/singles/*` fallbacks (`artworkPublicFallback.ts`, `frontendMediaFallbacks.ts`) |
| Third-party | Printful API, Stripe, `img.youtube.com` |
| Mock (no Supabase) | `https://signed.local/...`, `https://signed-upload.local/...` |

**R2:** **MISSING**

---

## 2. BACKEND UPLOAD FLOW (Control System)

### **PARTIAL** — intent/complete pipeline exists; DB persistence split between in-memory and durable paths

**Entry:** `POST /Users/recharge/2MRRW-Control-System/src/app/api/admin/media/upload-intent/route.ts` → `createMediaUploadIntent()`  
**Complete:** `POST .../upload-complete/route.ts` → `confirmMediaUpload()` → optional `applyMediaSyncRouting()`

**Flow:** validate category/MIME/size → build path under `protected-media` prefix → `createSignedUploadUrl` → client PUT → `confirmMediaUpload` (in-memory `confirmedMediaAssets` + draft metadata; `durable: false` in event payload).

**Durable DB writes (separate paths):**
- `mediaReplacementService.ts` → `media_assets`, `release_media`, `media_asset_versions`
- `releaseService.ts` publish → `media_assets` upsert
- `frontendReleaseIngestionService.ts` → `media_assets` upsert
- `storageBackfillService.ts` → HTTP fetch public frontend URL → `supabase.storage.upload`

#### Format support vs audit list (`uploadIntentService.ts` + `audioSupport.ts`)

| Category | Accepted | Missing from audit list |
|----------|----------|-------------------------|
| Audio masters/previews | mp3, wav, aif, aiff, flac, aac, m4a | **ogg, opus** |
| Video | mp4, mov, webm | **m4v, avi, mkv** |
| Images/covers | jpg, jpeg, png, gif, webp | **svg, avif** (svg rejected in tests) |
| Lyrics/docs | txt, pdf, docx | **zip** |
| Streaming | — | **m3u8, ts — MISSING** |

**Prefixes → DB:** `media_assets.bucket`, `media_assets.storage_path`, `release_media.asset_role`; vault via `vault_content.{preview,media}_storage_path` on sync.

**R2:** All `supabase.storage.from("protected-media")` and `createSignedUploadUrl` in `uploadIntentService.ts`, `signedUrlService.ts`, `storageBackfillService.ts`.

---

## 3. FRONTEND SERVE (artist-platform)

### **PARTIAL** — mostly static `public/`; entitled audio rarely hits signed-URL API

| Media | Serve path | Code |
|-------|------------|------|
| **Audio preview/full** | `/public/audio/previews/*`, `/public/audio/full/*` | `page.js` hardcoded; `resolvePlaybackSrc()` in `music-access.js` |
| **Cinematic video** | `/videos/singles/*.mp4`, `/videos/A2B.mp4` | `page.js` `<video data-cinematic-video>` |
| **Images** | `/images/**` | catalog, `collectorCardCatalog.js`, checkout |
| **Catalog API** | Control System `GET /api/public/releases` | `lib/control-system/releases.js` → signed URL or public fallback |
| **Library download** | `GET /api/library/stream?slug=` | **Implemented but not called from components** (docs only) |
| **Vault** | `GET /api/vault/media` → `digital-assets` signed URL or external URL | `vault/media/route.js` |
| **QR/access** | `GET /api/access/[token]` → redirect signed URL | `access/[token]/route.js` |
| **YouTube “video”** | External embed | `audio-visuals.js`, `page.js` |

**Player:** `AudioContext.js` sets `src` from track object (public or pre-resolved Control System URL), not `library/stream`.

**R2:** **MISSING**

---

## 4. SUPABASE STORAGE BUCKETS

### **PARTIAL** — two buckets, overlapping roles

| Bucket | Purpose | URL pattern (today) | Code refs |
|--------|---------|---------------------|-----------|
| **`digital-assets`** | Legacy commerce/library/vault; manifest target layout `singles/`, `albums/`, `artists/` | `{SUPABASE_URL}/storage/v1/object/sign/digital-assets/{path}` | `library/stream/route.js`, `vault/media/route.js`, `access/[token]/route.js`, `storage/digital-assets.manifest.json`, `scripts/apply-storage-architecture.mjs` |
| **`protected-media`** | Control System canonical: `masters/`, `previews/`, `artwork/`, `loops/`, `vault/`, `lyrics/`, `singles/{id}/`, etc. | Same Supabase sign pattern | All Control System media services; env `SUPABASE_MEDIA_BUCKET` |

**Public bucket:** **MISSING** (both documented as private).

**R2:** **MISSING**

---

## 5. STORAGE PATH CONSISTENCY

### **PARTIAL** — three parallel naming systems

| System | Pattern | Example |
|--------|---------|---------|
| **`products.storage_path`** | Flat slug paths | `singles/hour-glass/audio.mp3` (`catalog.js`, `seed-products.mjs`) |
| **`digital-assets.manifest`** | Canonical per-release files | `singles/hour-glass/audio.mp3`, `cover.jpg`, `visual.mp4` |
| **`protected-media` uploads** | Owner-id folders | `masters/{releaseId}/{trackId}/...`, `singles/{releaseId}/cover/...` |

**Mismatches:**
- Manifest `localSourcePath` uses `images/singles/hourglass.jpg` but DB `cover_url` is `/images/singles/hourglass.jpg` (leading slash).
- Motion: manifest `visual.mp4` vs public `videos/singles/hourglass.mp4` (different folder/filename).
- `products.storage_path` points at **full audio in `digital-assets`** while playback UI uses **`public/audio`** previews.
- Docs warn: do not change `storage_path` until Supabase objects exist (`SUPABASE_STORAGE_ARCHITECTURE.md`).

**R2:** N/A until bucket backend is chosen.

---

## 6. IMAGE / COVER ART

### **PARTIAL**

**Local images (9 JPGs):** listed in §1 under `public/images/`.

**Referenced but MISSING on disk:** `/images/merch/{hoodie,shirt,hat}.jpg` (catalog + Printful route).

**`cover_url` sources:** `products.cover_url`, `vault_content.cover_url`, hardcoded catalog, collector cards, exclusive-drops fallback `/images/albums/lovehz.jpg`.

**Supabase:** manifest `*/cover.jpg` under `digital-assets`; Control System `artwork/{slug}/cover.*` in `protected-media`.

**External:** YouTube thumbnails; Printful product images when API succeeds.

**R2:** **MISSING**

---

## 7. AUDIO PLAYER STREAM ENDPOINT

### **PARTIAL** — signed route exists; UI bypasses it for playback

**Documented entitled path:**  
`Click play` → `resolveTrackAccess()` (`music-access.js`) → if `canStream`, `resolvePlaybackSrc()` returns **`track.full` / `track.audio` / public preview** → `AudioContext` loads URL directly.

**`GET /api/library/stream?slug=`** (`library/stream/route.js`):
1. `getGuestUser()` → 401 if none  
2. `userOwnsProduct(userId, slug)` → 403  
3. `products.storage_path`  
4. `digital-assets` `createSignedUrl(..., 3600)`  
5. JSON `{ url, expiresIn: 3600 }`

**Control System path:** release assets → `/api/media/{assetId}/signed-url` (300s, entitlement checks in `signedUrlService.ts`).

**Where files live today:** previews/full in **`public/audio/`**; purchased masters expected in **`digital-assets`** per `storage_path` (may be empty in Supabase).

**Gap:** No component grep hit on `library/stream`; offline download uses `resolvePlaybackSrc` public URL, not signed stream.

**R2:** **MISSING**

---

## 8. VIDEO / VAULT

### **PARTIAL**

| Asset | Location | Status |
|-------|----------|--------|
| Single loops | `public/videos/singles/*.mp4` | **EXISTS** (4 files) |
| Hero/cinematic | `public/videos/A2B.mp4` | **EXISTS** |
| Vault shelf/content | `vault_content.media_storage_path` / `content_url` | **PARTIAL** — API + DB; binaries in Supabase or external URL |
| HLS `.m3u8` / `.ts` | — | **MISSING** everywhere |
| `.mov .webm .mkv` etc. | Upload accept only (Control System) | **MISSING** on disk in frontend |

**Vault video route:** `artist-platform` `vault/media/route.js` (same `digital-assets` bucket as library).

**R2:** **MISSING**

---

## 9. GIF

### **MISSING** (files) / **PARTIAL** (upload + DB field)

- **No `.gif` files** in either repo (find returned empty).
- **Upload accept:** `.gif` in Control System `MediaUploadPanel.tsx`, `CreatorReleaseSystem.tsx`, `mediaValidation.ts`.
- **Community:** `circle_posts.gif_url` (`006_community_circle_system.sql`, `community/circle/route.js`) — URL stored in DB, not local file.

**R2:** **MISSING**

---

## 10. FULL CHAIN — Backend Upload → Frontend Display

| Media type | Upload (Control System) | Storage | Frontend display |
|------------|-------------------------|---------|------------------|
| **Single master audio** | `audio_full_song` / `track_audio` → `masters/{releaseId}/{trackId}/` | `protected-media` + `media_assets` on publish/replace | CS signed URL or **`public/audio/full/*.mp3`** fallback |
| **Preview audio** | `audio_preview` → `previews/...` | Same | **`public/audio/previews/*`** or signed preview |
| **Cover still** | `single_cover_art` → `singles/{releaseId}/cover/` | `protected-media` | `/images/singles/*.jpg` or signed artwork |
| **Motion cover** | cover upload mp4/mov/webm | `protected-media` | `/videos/singles/{basename}.mp4` via `slugMotionPublicUrl` |
| **Album cover** | `album_cover_art` | `albums/...` | `/images/albums/*.jpg` |
| **Lyrics** | `lyrics` → txt/pdf/docx | `lyrics/...` | Glyph/preview components (LRC paths in manifest) |
| **Vault media** | `vault_asset` | `vault/...` + `vault_content` columns | `GET /api/vault/media` → signed or `content_url` |
| **Collector card** | `collector_card_asset` | `collectors/...` | Cards use static `/images/albums/*.jpg` + optional `videoSrc` |
| **Product download** | ingest/sync sets `products.storage_path` | **`digital-assets`** | `library/stream` (unused in UI) |
| **YouTube visual** | DB metadata only | N/A | iframe + `img.youtube.com` |
| **Merch** | Printful | External | DB `cover_url` + missing local merch JPGs |
| **HLS** | — | — | **MISSING** |

---

## 11. MIGRATION IMPACT MAP (Exhaustive)

Everything that must change or be decided for R2 (grouped by repo).

### A. Environment variables

**artist-platform**
- `NEXT_PUBLIC_SUPABASE_URL` (sign URL host today)
- `SUPABASE_SERVICE_ROLE_KEY` (admin signing)
- `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL`
- `NEXT_PUBLIC_SITE_URL` / site URL helpers in checkout
- *(new)* `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_*`, `R2_PUBLIC_BASE_URL` or custom domain, JWT/signing secret for CDN

**Control System**
- `SUPABASE_MEDIA_BUCKET`
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `ARTIST_PLATFORM_PUBLIC_URL` / `NEXT_PUBLIC_FRONTEND_URL` (backfill + fallbacks)
- `CONTROL_SYSTEM_ALLOWED_ORIGINS`
- Same R2 vars as above

### B. artist-platform — API routes (Supabase `storage` / signed URLs)

- `/Users/recharge/artist-platform/src/app/api/library/stream/route.js`
- `/Users/recharge/artist-platform/src/app/api/vault/media/route.js`
- `/Users/recharge/artist-platform/src/app/api/access/[token]/route.js`
- `/Users/recharge/artist-platform/scripts/apply-storage-architecture.mjs`
- `/Users/recharge/artist-platform/scripts/verify-setup.mjs` (bucket check)

### C. artist-platform — libs / hooks / context

- `/Users/recharge/artist-platform/src/lib/control-system/media.js` (`fetchSignedUrl`, asset resolution)
- `/Users/recharge/artist-platform/src/lib/control-system/releases.js`
- `/Users/recharge/artist-platform/src/lib/music-access.js`, `music-playback.js`
- `/Users/recharge/artist-platform/src/lib/offline-cache.js` (stream URLs)
- `/Users/recharge/artist-platform/src/context/AudioContext.js`
- `/Users/recharge/artist-platform/src/hooks/media/useMediaAssets.js`
- `/Users/recharge/artist-platform/src/hooks/releases/useReleases.js`
- `/Users/recharge/artist-platform/src/lib/vault-audio.js`, `lib/vault/access.js`

### D. artist-platform — UI / pages (static paths)

- `/Users/recharge/artist-platform/src/app/page.js` (audio/video/ambient paths)
- `/Users/recharge/artist-platform/src/lib/commerce/catalog.js`
- `/Users/recharge/artist-platform/scripts/seed-products.mjs`
- `/Users/recharge/artist-platform/src/components/collectors-cards/collectorCardCatalog.js`
- `/Users/recharge/artist-platform/src/app/api/printful/products/route.js`
- `/Users/recharge/artist-platform/src/components/preview/*`, `collectors-cards/*`, `music/*`
- Entire `/Users/recharge/artist-platform/public/audio/**`, `public/videos/**`, `public/images/**` (migrate or CDN-map)

### E. artist-platform — data / docs / scripts

- `/Users/recharge/artist-platform/storage/digital-assets.manifest.json`
- `/Users/recharge/artist-platform/storage/metadata-templates/**`
- `/Users/recharge/artist-platform/docs/SUPABASE_STORAGE_ARCHITECTURE.md`
- `/Users/recharge/artist-platform/docs/AUTH_COMMERCE_SETUP.md`
- `/Users/recharge/artist-platform/supabase/migrations/001_auth_commerce_library.sql` (bucket comment)
- `/Users/recharge/artist-platform/supabase/migrations/008_vault_entitlement_persistence.sql` (`preview_storage_path`, `media_storage_path`)
- `/Users/recharge/artist-platform/supabase/migrations/002_repair_purchases_status.sql` (`products.storage_path`, `preview_path`)

### F. Control System — storage services

- `/Users/recharge/2MRRW-Control-System/src/server/media/uploadIntentService.ts` (`createSignedUploadUrl`, bucket constant)
- `/Users/recharge/2MRRW-Control-System/src/server/media/signedUrlService.ts` (`createSignedUrl`, fallback)
- `/Users/recharge/2MRRW-Control-System/src/server/media/storageBackfillService.ts`
- `/Users/recharge/2MRRW-Control-System/src/server/media/mediaReplacementService.ts`
- `/Users/recharge/2MRRW-Control-System/src/server/media/catalogMediaUrl.ts`
- `/Users/recharge/2MRRW-Control-System/src/server/media/artworkPublicFallback.ts`
- `/Users/recharge/2MRRW-Control-System/src/lib/media/frontendMediaFallbacks.ts`
- `/Users/recharge/2MRRW-Control-System/src/server/releases/releaseService.ts` (`media_assets` upsert)
- `/Users/recharge/2MRRW-Control-System/src/server/release-management/frontendReleaseIngestionService.ts`
- `/Users/recharge/2MRRW-Control-System/src/server/sync/frontendCatalogSyncService.ts` (`storage_path`, vault paths → artist-platform products)
- `/Users/recharge/2MRRW-Control-System/src/storage/protected-media.md`

### G. Control System — API routes

- `/Users/recharge/2MRRW-Control-System/src/app/api/admin/media/upload-intent/route.ts`
- `/Users/recharge/2MRRW-Control-System/src/app/api/admin/media/upload-complete/route.ts`
- `/Users/recharge/2MRRW-Control-System/src/app/api/media/[assetId]/signed-url/route.ts`
- `/Users/recharge/2MRRW-Control-System/src/app/api/releases/[slug]/media/route.ts`
- `/Users/recharge/2MRRW-Control-System/src/app/api/vault/content/[id]/media/route.ts`
- `/Users/recharge/2MRRW-Control-System/src/app/api/health/storage/route.ts`
- `/Users/recharge/2MRRW-Control-System/src/app/api/admin/ops/backfill-covers/route.ts`
- `/Users/recharge/2MRRW-Control-System/scripts/backfill-storage-covers.ts`

### H. Control System — UI upload clients

- `/Users/recharge/2MRRW-Control-System/src/components/control/MediaUploadPanel.tsx`
- `/Users/recharge/2MRRW-Control-System/src/components/control/CreatorReleaseSystem.tsx`
- `/Users/recharge/2MRRW-Control-System/src/components/control/MediaSyncReleaseStudio.tsx`
- `/Users/recharge/2MRRW-Control-System/src/lib/uploads/uploadMedia.ts`, `mediaValidation.ts`

### I. Database columns / tables (both apps share Supabase)

- `products.storage_path`, `products.preview_path`, `products.cover_url`
- `vault_content.preview_storage_path`, `media_storage_path`, `cover_url`, `content_url`, `preview_url`
- `media_assets.bucket`, `media_assets.storage_path`, `access_level`
- `release_media`, `media_asset_versions`
- `circle_posts.gif_url`
- Migration: `/Users/recharge/2MRRW-Control-System/src/db/migrations/0004_release_management_foundation.sql`

### J. URL patterns to replace

- `https://{project}.supabase.co/storage/v1/object/sign/{bucket}/{path}`
- `https://signed.local/...` / `https://signed-upload.local/...` (dev mocks)
- Hardcoded `https://artist-platform-silk.vercel.app/images|videos/...`
- Relative `/audio/`, `/videos/`, `/images/` in catalog and `page.js`

### K. Tests & verification

- `/Users/recharge/2MRRW-Control-System/tests/backend-foundation.test.ts` (bucket, signed URL, fallback URLs)
- `/Users/recharge/2MRRW-Control-System/tests/stability-foundation.test.ts`
- `/Users/recharge/artist-platform/scripts/validate-storage-manifest.mjs`

### L. Architectural decisions required before R2

1. **Single bucket vs dual** — retire `digital-assets` vs `protected-media` or map both to one R2 bucket with prefixes.
2. **Public vs signed CDN** — previews/motion currently public on Vercel; masters must stay signed.
3. **Replace `artworkPublicFallback.ts`** — today it proxies missing Supabase objects to Vercel static; R2 needs explicit policy.
4. **Upload protocol** — swap `createSignedUploadUrl` / `createSignedUrl` for S3-compatible presigned PUT/GET (R2).
5. **Path normalization** — reconcile `products.storage_path`, manifest paths, and `masters/{uuid}/` layouts.
6. **Format expansion** — ogg/opus/HLS/avi/mkv not in pipelines today.
7. **Wire `library/stream`** or remove dead route after R2 signing layer exists.

---

## Summary table

| # | Area | Status |
|---|------|--------|
| 1 | Current storage locations | **PARTIAL** |
| 2 | Backend upload flow | **PARTIAL** |
| 3 | Frontend serve | **PARTIAL** |
| 4 | Supabase buckets | **PARTIAL** (dual bucket) |
| 5 | Path consistency | **PARTIAL** |
| 6 | Cover art | **PARTIAL** |
| 7 | Audio stream endpoint | **PARTIAL** |
| 8 | Video / vault | **PARTIAL** |
| 9 | GIF | **MISSING** (files) |
| 10 | End-to-end chains | **PARTIAL** |
| 11 | R2 impact map | **EXISTS** (this section) |
| — | **Cloudflare R2 integration** | **MISSING** |

**Highest-risk gaps for R2:** dual Supabase buckets + frontend static fallbacks + upload/read entirely on `@supabase/storage-js` + playback not using the entitled signed-stream API today.