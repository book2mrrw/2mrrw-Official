# Singles vs Features Playback Audit — 2026-05-29

**Repo:** `/Users/recharge/artist-platform`  
**Branch / HEAD:** `main` @ `85e7ccd57797369c31262d9d0d0619c6490d90b7`  
**Mode:** READ ONLY — no code changes in this audit  
**Prompt:** `/Users/recharge/Downloads/cursor-singles-vs-features-audit.md`

**Compared slugs:**
| Role | Singles (working) | Features (broken preview) |
|------|-------------------|---------------------------|
| Primary | `hour-glass` | `i-dont-believe-you` |
| Secondary | `w2d` | `2-heavy` |

---

## Prompt requirements summary

The audit prompt required:

1. Trace play-button → audio bytes for one working single (`w2d`) and one broken feature (`i-dont-believe-you`) side by side at six steps: click handler, `releaseType`, playback source resolution, catalog/metadata lookup, entitlement, API route.
2. Produce a side-by-side table marking **MATCH** vs **DIFFER** on every row; highlight all **DIFFER** rows.
3. State the single most likely root cause at the **first divergence point**.
4. Cite exact file and line for each divergence.
5. Audit only — no fixes.
6. Compare preview, stream, visual, entitlement, R2 paths, and catalog merge.

This report extends the prompt comparison to all four named slugs and includes live R2/DB verification.

---

## Side-by-side trace table

| Step | Singles (`hour-glass` / `w2d`) | Features (`i-dont-believe-you` / `2-heavy`) | Match? |
|------|----------------------------------|-----------------------------------------------|--------|
| **1 — Play button / click handler** | **CarouselUI** cover overlay → `onSingleClick` → `openSingleModal` (`page.js:1206-1208`, `1132`). Home carousel row uses inline play overlay, not `ReleaseCardPlayButton`. **FeaturesRail** card cover → `onOpenFeature` → `openFeatureModal` (`FeaturesRail.js:22`, `page.js:1146-1163`). Inline play uses **same** `ReleaseCardActions` → `ReleaseCardPlayButton` → `toPlaybackTrack` → `playQueue` (`FeaturesRail.js:50-64`, `ReleaseCardPlayButton.js:48-58`). Both modals call `playCanonicalCatalogItem` → `normalizeTrackForPlayback` → `playTrack` (`page.js:1041-1049`). | Same downstream pipeline after different entry components. Modal uses shared **ImmersivePreviewModal** (`page.js:1590-1624`). | **DIFFER** (entry UI components differ; playback pipeline converges) |
| **1b — Args at play press** | `{ slug, type:"single", preview, cover, video, … }` — no `releaseType`, no `trackSlug` (`page.js:175-199`). Source: `"preview_modal"` or `"home_card"`. | `{ slug, type:"feature", preview, cover, featuring, … }` — no `releaseType`, no `trackSlug` (`page.js:169-171`). Source: `"feature_modal"` or `"home_feature_card"`. | **DIFFER** (`type` string; singles carry `video`, features carry `featuring`) |
| **2 — releaseType value** | Inline `type: "single"`. Canonical `release_type: "single"` → normalized folder **`singles`** (`canonical-catalog.js:84-88`, `normalize-release-type.js:6-7`). Not passed as a playback arg; inferred from slug via `mergeCanonicalMetadata` / `getCanonicalReleaseBySlug`. | Inline `type: "feature"`. Canonical `release_type: "feature"` → normalized folder **`features`** (`canonical-catalog.js:104-121`). DB `product_type: "feature"`. Server `inferProductReleaseType` maps `"feature"` → `"features"` (`resolve-playback-key.js:104-111`). | **DIFFER** (folder segment); **MATCH** (both correctly infer `singles` vs `features` when DB + canonical present) |
| **2b — Missing releaseType risk** | If metadata absent, `inferProductReleaseType` defaults to **`"singles"`** (`resolve-playback-key.js:125`). Singles unaffected. | Same default — would mis-route only if slug + storage_path + canonical all fail. Current DB rows have `product_type:"feature"` and `storage_path: features/…` — safe. | **MATCH** today; latent **DIFFER** risk at `resolve-playback-key.js:125` |
| **3 — Playback source resolution (client)** | `resolvePlaybackSrc` (`music-access.js:224-244`): guest → `catalogPreviewAudioUrl(preview_path)`; entitled → `/api/library/stream?slug={slug}&redirect=1`. Preview URL example (w2d): `/api/media/preview?folder=previews/singles/w2d/&legacy=previews/singles/w2d/w2d-preview.mp3` | Same functions. Preview URL example: `/api/media/preview?folder=previews/features/i-dont-believe-you/&legacy=previews/features/i-dont-believe-you/i-dont-believe-you-preview.wav` | **MATCH** (code path) |
| **3b — R2 key (full stream)** | `digital-assets/singles/w2d/audio.mp3` ✅ (`verify-r2-entity-folders.mjs` probe) | `digital-assets/features/i-dont-believe-you/I Don't Believe You ft. 2mrrw.wav` ✅ | **DIFFER** (folder + filename convention); both resolve non-null |
| **3c — R2 key (preview)** | `previews/singles/w2d/w2d-preview.mp3` ✅ HTTP 200 | `previews/features/i-dont-believe-you/` **empty**; legacy `previews/features/…/i-dont-believe-you-preview.wav` ❌ HTTP 404; flat `previews/i-dont-believe-you-preview.wav` ❌ HTTP 404 | **DIFFER** — **first functional divergence** |
| **3d — releaseType switch/map** | `CANONICAL_CATALOG.singles`, `RELEASE_TYPE_ALIASES.single → singles`, `resolveStoragePath` / `resolvePreviewPath` all include `features` (`canonical-catalog.js:18-55`, `canonical-paths.js:67-82`). No branch that lists `"singles"` but omits `"features"`. | Same maps include `features`. `discoverAudioInFolder` has features→singles **fallback** (`resolve-playback-key.js:96-98`) — not needed; master already under `features/`. | **MATCH** in code maps |
| **4 — Catalog / metadata lookup** | Present in `CANONICAL_SINGLES` (`canonical-catalog.js:58-98`). `mergeCanonicalMetadata` enriches slug (`canonical-catalog.js:442-488`). In `catalogPlaybackLookup` (`page.js:782-790`). DB: `storage_path: singles/w2d/`, `preview_path: previews/singles/w2d/` | Present in `CANONICAL_FEATURES` (`canonical-catalog.js:102-122`). Same merge + lookup. DB: `storage_path: features/i-dont-believe-you/`, `preview_path: previews/features/i-dont-believe-you/` | **MATCH** (structure); **DIFFER** (inline preview shape — see below) |
| **4b — Inline preview in page.js** | Legacy flat: `preview: "/audio/previews/w2d-preview.mp3"` (`page.js:195`) | Entity folder: `preview: "previews/features/i-dont-believe-you/"` (`page.js:170`) | **DIFFER** |
| **4c — mergeCanonicalMetadata priority** | After merge: `preview_path: previews/singles/w2d/`, `preview` → discovery API URL | After merge: `preview_path: previews/features/i-dont-believe-you/`, `preview_ext: wav` | **DIFFER** (extension + inline shape) |
| **4d — music-playback merge** | `normalizeCatalogItemForPlayback` prefers `preview_path` over `preview` (`music-playback.js:53-58`) — post-`85e7ccd` fix applies to features too | Same | **MATCH** |
| **5 — Entitlement check** | `resolveTrackAccess` slug-only; no release-type branch (`music-access.js:103-201`). Guest: `canStream:false`, `previewOnly:true`. Subscriber/admin/collector: `canStream:true`. | Identical logic for feature slugs | **MATCH** |
| **5b — Stream route entitlement** | `/api/library/stream` + `userCanStreamProduct` (`route.js:44-54`) | Same route, same check | **MATCH** |
| **6 — API route (guest preview)** | `GET /api/media/preview?folder=previews/singles/w2d/&legacy=…` → 302 → CDN MP3 **200** | `GET /api/media/preview?folder=previews/features/i-dont-believe-you/&legacy=…` → **404** `{ error: "Media not found" }` (`preview/route.js:78-79`) | **DIFFER** |
| **6b — API route (entitled stream)** | `/api/library/stream?slug=w2d&redirect=1` → resolves key → proxy MP3 | `/api/library/stream?slug=i-dont-believe-you&redirect=1` → should resolve features master WAV (R2 present; DB path correct) | **MATCH** (expected); preview failure dominates guest UX |
| **6c — Visual media** | `coverArtType: "video"`, motion loop under `videos/singles/{slug}/` ✅ (`enrichRelease.js:213-216`, `catalogMedia.js:15-21`) | `coverArtType: "image"`, no video folder objects (`verify-r2` empty video keys) | **DIFFER** (by design in canonical catalog) |

---

## Key findings / divergences

### 1. Client playback pipeline is unified (post-`85e7ccd`)

Singles and features share:

- `ReleaseCardPlayButton` / `toPlaybackTrack` / `resolvePlaybackSrc` / `AudioContext.playTrack`
- Same preview API (`/api/media/preview`) and stream API (`/api/library/stream`)
- Same entitlement module (`music-access.js`)
- Same canonical catalog merge (`mergeCanonicalMetadata` + `withR2CatalogMedia`)

Entry components differ (CarouselUI vs FeaturesRail) but converge before audio load.

### 2. First functional divergence: R2 preview objects missing for features

Live probes (2026-05-29):

| Object | hour-glass / w2d | i-dont-believe-you / 2-heavy |
|--------|------------------|------------------------------|
| Preview entity folder | ✅ files present | ❌ **empty** |
| Legacy flat preview | N/A (entity used) | ❌ **404** on CDN |
| Master audio (`digital-assets/…`) | ✅ | ✅ |
| Preview CDN HEAD | **200** MP3 | **404** WAV |

Guest playback sets `src` to `/api/media/preview?…`. Preview route discovers folder + legacy candidates (`preview/route.js:67-68`, `entity-resolver.js:194-200`). With no R2 objects, API returns **404** → `<audio>` error → `AudioContext` shows **"Preview unavailable"** (`AudioContext.js:1215-1228`).

Singles work because `previews/singles/{slug}/` contains `{stem}-preview.mp3`.

### 3. Inline catalog shape still differs (cosmetic, not root cause)

- Singles: legacy flat `/audio/previews/{stem}-preview.mp3` in `page.js`
- Features: entity folder `previews/features/{slug}/` in `page.js`

Both normalize to the same discovery API via `catalogPreviewAudioUrl` (`media-urls.js:87-116`). Failure is **storage**, not URL builder.

### 4. Full stream path should work for entitled users

R2 verification shows master WAV in `digital-assets/features/{slug}/`. DB products rows:

```json
{"slug":"i-dont-believe-you","product_type":"feature","storage_path":"features/i-dont-believe-you/","preview_path":"previews/features/i-dont-believe-you/"}
{"slug":"w2d","product_type":"single","storage_path":"singles/w2d/","preview_path":"previews/singles/w2d/"}
```

`resolvePlaybackKey` builds `digital-assets/features/{slug}/`, discovers audio (`resolve-playback-key.js:163-165`). Entitled `resolvePlaybackSrc` targets `/api/library/stream` (`music-access.js:230-237`). **404 stream failures reported in older audits should be resolved** if DB was re-seeded; guest preview remains broken until preview files upload.

### 5. Visual / cover divergence (non-audio)

Features use static image covers (`coverArtType: "image"`, `catalogMedia.js:15`); singles use motion video loops. This does not block audio but explains different card/modal presentation.

### 6. Preview format: MP3 vs WAV

Canonical defaults: singles `preview_ext: mp3`, features `preview_ext: wav` (`canonical-catalog.js:65-120`, `canonical-paths.js:169-174`). Features previews are larger WAVs when uploaded — secondary latency concern, not current blocker (files absent).

---

## Single most likely root cause

**First divergence:** Step 3c — **R2 preview storage**.

Feature preview entity folders (`previews/features/i-dont-believe-you/`, `previews/features/2-heavy/`) and all legacy preview keys return **404**. Singles have populated preview folders. The code routes both to `/api/media/preview`; singles succeed, features fail.

**Root cause statement:** Features audio appears broken for typical guest / preview-only listeners because **preview WAV/MP3 objects were never uploaded to the canonical `previews/features/{slug}/` paths** (nor legacy flat fallbacks), while singles previews exist at `previews/singles/{slug}/`. The playback resolver and catalog merge are aligned; the gap is **R2 content**, not a missing `"features"` branch in client code.

---

## File / line reference index (DIFFER rows)

| Topic | Location |
|-------|----------|
| Inline singles vs features arrays | `src/app/page.js:169-224` |
| `openSingleModal` vs `openFeatureModal` | `src/app/page.js:1117-1177` |
| Shared play pipeline | `src/app/page.js:1041-1049` |
| Features rail play | `src/components/home/FeaturesRail.js:8-64` |
| Singles carousel play | `src/components/home/CarouselUI.js:45-47,72-74` |
| `releaseType` normalization | `src/lib/media/utils/normalize-release-type.js:8-16` |
| Server release type inference + singles default | `src/lib/playback/resolve-playback-key.js:104-125` |
| R2 path builders | `src/lib/media/canonical-paths.js:67-132` |
| Canonical singles vs features | `src/lib/media/canonical-catalog.js:58-122` |
| Preview URL builder | `src/lib/media-urls.js:87-116` |
| Preview API 404 | `src/app/api/media/preview/route.js:78-79` |
| Stream route | `src/app/api/library/stream/route.js:56-108` |
| Preview unavailable UX | `src/context/AudioContext.js:1215-1228` |
| `preview_path` priority fix | `src/lib/music-playback.js:53-58` |

---

## Verification artifacts

- `r2-probes.txt` — CDN HEAD results + `verify-r2-entity-folders.mjs` JSON excerpt
- `db-products.json` — Supabase `products` rows for four slugs
- `manifest.txt` — file list

---

## Commit hash (fixes)

**None applied in this audit session.** Audited current HEAD `85e7ccd` which already contains feature path fixes from prior work (`fix(media): extend feature preview/stream path fixes to all Features catalog tracks`).

---

## Recommended next step (ops, not code)

Upload preview audio for each feature slug (minimum one file per folder):

- `previews/features/i-dont-believe-you/i-dont-believe-you-preview.wav`
- `previews/features/2-heavy/2-heavy-preview.wav`

Verify: `node scripts/verify-r2-entity-folders.mjs --json` → `hasPreview: true` for both.
