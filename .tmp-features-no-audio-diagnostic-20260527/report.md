# Features No-Audio Diagnostic — `i-dont-believe-you` & `2-heavy`

**Repo:** `/Users/recharge/artist-platform`  
**Branch / HEAD:** `main` @ `ef5d36d` (entitlement fixes)  
**Date:** 2026-05-28  
**Mode:** READ ONLY — no code changes

**Slugs traced:** `i-dont-believe-you`, `2-heavy`  
**Working control:** `hour-glass`

---

## Executive summary

Features share the same client playback pipeline as singles after `51af6ff` / `displayFeatures` R2 normalization. R2 **preview objects return HTTP 200**. The most likely **exact failure** for typical production testers (subscriber / admin / collector) is:

**Entitled playback targets `/api/library/stream` but feature products have no `storage_path` (and no linked `media_assets`), so the stream route returns **404 JSON**; the `<audio>` element cannot decode that response; post-`ef5d36d` error handling does **not** fall back to preview on 404 or on entitled 403.**

Guests should hit the R2 WAV preview URL directly; if they also hear nothing, secondary causes are **multi‑MB WAV latency** or **decode/buffer timing**, not missing catalog slugs.

---

## Exact failure point (primary)

| Step | File:Line | What happens |
|------|-----------|--------------|
| 1 | `src/lib/music-access.js:214-221` | Subscriber/admin: `access.canStream === true` → `resolvePlaybackSrc` returns `/api/library/stream?slug=i-dont-believe-you&redirect=1` (not preview CDN). |
| 2 | `src/lib/music-playback.js:168-180` | `toPlaybackTrack` sets `src` to that stream URL; `metadata.previewSrc` is set but unused for initial `syncSrc` when entitled. |
| 3 | `src/context/AudioContext.js:1248-1254` | `playTrack`: `redirectFastPath` → `syncSrc = nextTrack.src` (library stream URL). |
| 4 | `src/context/AudioContext.js:1496-1500` | `loadAudioSrcAndPlay(audio, syncSrc)` assigns API URL to `<audio>`. |
| 5 | `src/app/api/library/stream/route.js:67-70` | `resolvePlaybackKey(admin, slug)` → **null** (no `products.storage_path`, no track/media link in catalog seed). |
| 6 | `src/app/api/library/stream/route.js:68-70` | Response: **404** `{ "error": "No downloadable asset for this item" }` (no 302 redirect). |
| 7 | `src/context/AudioContext.js:926-930` | `<audio>` `error` event → `onError` logs `[stream] playback error`. |
| 8 | `src/context/AudioContext.js:1259-1296` | `applyStreamResolveError` / retry path: preview fallback only for **401** or **403 when not entitled** (`ef5d36d` F1). **404 is not handled** → user hears nothing / “Stream unavailable”. |

**Contrast — `hour-glass` (working entitled path):**

| Step | File:Line | Difference |
|------|-----------|------------|
| Catalog | `src/lib/commerce/catalog.js:3` | `storage_path: "singles/hour-glass/audio.mp3"` |
| Stream | `route.js:77-84` | `resolvePlaybackKey` succeeds → **302** to signed R2 GET |
| Audio | `AudioContext.js:1500` | Element loads decodable MP3 |

---

## End-to-end trace (checklist)

### 1. `page.js` — inline features, `displayFeatures`, `openFeatureModal`

| Item | Location | Status |
|------|----------|--------|
| Inline array | `src/app/page.js:169-171` | Both slugs, `type:"feature"`, `preview:"/audio/previews/…-preview.wav"` |
| `displayFeatures` | `src/app/page.js:775-777` | `INLINE_FEATURES.map(withR2CatalogMedia)` — previews become R2 HTTPS URLs |
| `catalogPlaybackLookup` | `src/app/page.js:780-788` | Includes `displayFeatures` + singles + albums |
| `openFeatureModal` | `src/app/page.js:1138-1160` | `resolveCatalogPlaybackItem` → `toPlaybackTrack` → `playTrack` if `playbackTrack.src` truthy |

### 2. `FeaturesRail` click / play

| Path | Location | Behavior |
|------|----------|----------|
| Cover click | `FeaturesRail.js:21` | `onOpenFeature(feat)` → modal + `openFeatureModal` playback |
| Play button | `FeaturesRail.js:47-63` | `ReleaseCardActions` → `ReleaseCardPlayButton` → `playQueue([track])` |
| `showPlayActions` | `FeaturesRail.js:13` | `itemHasPlayableAudio(feat, access)` — true when preview path exists |

### 3. `music-playback.js` — normalize, resolve, preview URLs

| Function | Location | Features behavior |
|----------|----------|-------------------|
| `normalizeCatalogItemForPlayback` | `music-playback.js:37-49` | Preserves `preview` / `preview_path` |
| `resolveCatalogPlaybackItem` | `music-playback.js:66-97` | Merges inline + lookup by slug |
| `toPlaybackTrack` | `music-playback.js:148-192` | `resolvePlaybackSrc` + `metadata.previewSrc` always when preview path exists |

### 4. `toPlaybackTrack` / `resolveTrackAccess`

| Tier | `resolveTrackAccess` | `src` from `resolvePlaybackSrc` |
|------|----------------------|----------------------------------|
| Guest / no entitlement | `canStream: false`, `previewOnly: true` | R2 `…/previews/i-dont-believe-you-preview.wav` |
| Subscriber / admin / collector | `canStream: true` | `/api/library/stream?slug=…&redirect=1` |

`resolveTrackAccess`: `src/lib/music-access.js:103-201`  
`resolvePlaybackSrc`: `src/lib/music-access.js:214-227`

### 5. `playTrack` in `AudioContext` — src selection, 403 after F1

| Condition | `syncSrc` | File:Line |
|-----------|-----------|-----------|
| Guest (not entitled) | Preview CDN URL | `1249-1251` (if library stream + preview + !entitled) **or** direct preview as `track.src` |
| Entitled + redirect | Library stream API URL | `1252-1254` |
| Stream 403 + entitled (F1) | **No** preview fallback | `1260-1262` |
| Stream 401 | Preview fallback if `previewSrc` set | `1261-1294` |

### 6. `stream-client` — `/api/library/stream?slug=`

| Behavior | File:Line |
|----------|-----------|
| `fetchLibraryStream` sets `err.status` 401/403 | `stream-client.js:70-90` |
| Generic throw on 404 (no `err.status`) | `stream-client.js:99-101` |
| Redirect fast path not used on 404 | N/A — 404 returned before redirect |

### 7. `catalog.js` preview paths

```7:8:src/lib/commerce/catalog.js
  { slug: "i-dont-believe-you", ..., preview_path: "/audio/previews/i-dont-believe-you-preview.wav" },
  { slug: "2-heavy", ..., preview_path: "/audio/previews/2-heavy-preview.wav" },
```

**No `storage_path`** on either feature row (unlike singles line 3).

### 8. Products table / seed

| Source | Finding |
|--------|---------|
| `scripts/seed-products.mjs:22-30` | Upserts `storage_path: p.storage_path \|\| null` → features get **NULL** |
| `src/app/api/admin/seed-products/route.js` | Same pattern |
| Slugs | Present in `PRODUCT_CATALOG` — will exist in `products` if seeded |
| Full master on R2 (migration list) | `scripts/migrate-r2-bucket.mjs:24-25` — `digital-assets/singles/i-dont-believe-you/audio.wav`, `digital-assets/singles/2-heavy/audio.wav` — **not wired into catalog/DB** |

### 9. R2 preview HEAD probes (2026-05-28)

| Object | Status | Content-Type | Size |
|--------|--------|--------------|------|
| `previews/i-dont-believe-you-preview.wav` | **200** | audio/wav | 5,203,902 B |
| `previews/2-heavy-preview.wav` | **200** | audio/wav | 6,649,094 B |
| `previews/hourglass-preview.mp3` (control) | **200** | audio/mpeg | 831,656 B |

CDN: `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev`  
CORS for `Origin: https://www.2mrrw.com`: **present** (`Access-Control-Allow-Origin`).

### 10. `ImmersivePreviewModal` — real audio vs fake timer

| Question | Answer |
|----------|--------|
| Engine | **Real** — `useMediaEngine()` → `AudioContext` `playTrack` / `toggle` (`ImmersivePreviewModal.js:508-512`, `useMediaEngine.js:147-136`) |
| UI cap | Display-only **30s** label/scrub cap for preview mode (`PREVIEW_CAP_SEC = 30`, lines 12, 504-527) |
| Actual stop | `AudioContext` `PREVIEW_HARD_CAP_SEC` at `AudioContext.js:57, 780-802` |

Not a fake timer-only modal.

### 11. `ReleaseCardPlayButton` on feature cards

| Step | File:Line |
|------|-----------|
| `toPlaybackTrack` | `ReleaseCardPlayButton.js:48` |
| Early exit if no src | `ReleaseCardPlayButton.js:49` |
| Play | `playQueue([track], 0)` line 58 |
| Preload preview | `catalogPreviewAudioUrl` lines 23-31 |

---

## What the user sees in Network tab

### A. Subscriber / admin / collector (most likely reporter)

| Request | Method | Expected status | Response body / next hop |
|---------|--------|-----------------|---------------------------|
| `https://www.2mrrw.com/api/library/stream?slug=i-dont-believe-you&redirect=1` | GET (audio) | **404** | JSON `No downloadable asset for this item` — **not** audio bytes |
| Same for `slug=2-heavy` | GET | **404** | Same |
| Optional retry | GET `…/api/library/stream?slug=…` (no redirect) | **404** | From `onError` → `fetchLibraryStream` (`AudioContext.js:952-955`) |

**No** successful request to `…/previews/i-dont-believe-you-preview.wav` on entitled path unless user is actually on guest preview path.

If production not on `ef5d36d` / DB `product_type` wrong:

| Request | Status | Note |
|---------|--------|------|
| `…/api/library/stream?slug=i-dont-believe-you&redirect=1` | **403** | Pre-`97f2439` `feature` not digital |
| Post-F1 entitled | No preview fallback | `AudioContext.js:1260-1262` |

### B. Guest / logged-in without stream entitlement

| Request | Status | Notes |
|---------|--------|-------|
| `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/previews/i-dont-believe-you-preview.wav` | **200** / **206** | ~5 MB — long `waiting` before audible |
| Compare `hour-glass` | **200** | ~832 KB MP3 — faster start |

### C. Working control `hour-glass` (entitled)

| Request | Status |
|---------|--------|
| `/api/library/stream?slug=hour-glass&redirect=1` | **302** → signed R2 `…/singles/hour-glass/audio.mp3` |
| Preview (guest) | `…/previews/hourglass-preview.mp3` **200** |

---

## Singles vs features matrix

| Dimension | `hour-glass` | `i-dont-believe-you` / `2-heavy` |
|-----------|--------------|----------------------------------|
| Inline preview | `.mp3` ~0.8 MB | `.wav` ~5–6.5 MB |
| `PRODUCT_CATALOG.storage_path` | `singles/hour-glass/audio.mp3` | **missing** |
| Stream `resolvePlaybackKey` | Success | **null → 404** |
| `isDigitalProduct` (post-97f2439/ef5d36d) | `single` ✓ | `feature` ✓ |
| Entitled client `src` | Library stream | Library stream |
| Guest `src` | R2 MP3 preview | R2 WAV preview |
| Modal / card play wiring | Same pipeline | Same pipeline |

---

## Ranked root causes

| Rank | Cause | Likelihood | Evidence |
|------|-------|------------|----------|
| **1** | **Missing `storage_path` / playback key for feature products** → stream **404**, no preview fallback for entitled users | **HIGH** | `catalog.js:7-8`; `stream/route.js:67-70`; migrate script has masters but catalog does not |
| **2** | **F1 (`ef5d36d`): entitled 403 no longer falls back to preview** — if server still denies feature stream (stale deploy, DB `product_type`, entitlement bug) | **HIGH** for prod lag | `AudioContext.js:1260-1262`; fixed `feature` in `entitlements.js:252` but deploy/DB may lag |
| **3** | **404 / generic stream errors not mapped to preview fallback** — `fetchLibraryStream` 404 throws without `err.status` | **HIGH** | `stream-client.js:99-101`; `onError` retry never reaches preview branch |
| **4** | **Oversized WAV “previews”** (~5–6 MB) — slow `canplay`, appears broken on mobile | **MEDIUM** (guest / fallback) | HEAD probes; singles use ~1 MB MP3 |
| **5** | **Production `NEXT_PUBLIC_R2_PUBLIC_URL` mismatch** → preview 401 | **LOW** (probes 200 on documented CDN) | `r2-public-cdn.js:4-7` |
| **6** | Missing slugs / play not invoked | **RULED OUT** | Slugs in `page.js:170-171`, `catalog.js:7-8`; `openFeatureModal` + `ReleaseCardPlayButton` call `playTrack` |

---

## Suggested permanent fixes (numbered, specific — no implementation)

1. **Add canonical `storage_path` for both features** in `src/lib/commerce/catalog.js` (e.g. `digital-assets/singles/i-dont-believe-you/audio.wav` per `scripts/migrate-r2-bucket.mjs:24-25`), run seed/admin sync, verify `resolvePlaybackKey` returns a key in staging.

2. **Backfill `products.storage_path` in Supabase** for `i-dont-believe-you` and `2-heavy` (and link `content_id` to `tracks` / `media_assets` if that is the source of truth).

3. **Extend stream error handling** in `src/context/AudioContext.js` (`applyStreamResolveError`, `onError` retry): when `metadata.previewSrc` exists and stream fails with **404** or **500**, fall back to preview **even for entitled users** (degraded mode), with telemetry — avoids total silence when masters are missing.

4. **Re-encode feature previews** to ~30s **MP3/AAC** on R2 (`previews/i-dont-believe-you-preview.mp3`), update `page.js` + `catalog.js` paths — match singles latency policy (~1 MB).

5. **Confirm production deploy** includes `97f2439` (`feature` in `isDigitalProduct`) **and** `ef5d36d`; verify `products.product_type = 'feature'` for both slugs in prod DB.

6. **Optional product rule:** if `storage_path` is null but `preview_path` is set, `resolvePlaybackSrc` should use preview for stream requests (or stream route returns 302 to preview) — document in `music-access.js` to prevent entitled users from targeting a broken stream URL.

7. **QA matrix** after fixes: guest → R2 preview audible <3s; subscriber → 302 stream to full WAV/MP3; admin same; iOS Safari + one Android device.

---

## Verification commands (ops)

```bash
# Preview objects (public CDN)
curl -sI "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/previews/i-dont-believe-you-preview.wav"
curl -sI "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/previews/2-heavy-preview.wav"

# Stream (authenticated cookie required for meaningful result)
curl -sI "https://www.2mrrw.com/api/library/stream?slug=i-dont-believe-you&redirect=1"
```

---

## File reference index

| File | Relevance |
|------|-----------|
| `src/app/page.js:169-171, 775-777, 1138-1160, 1609-1621` | Feature data + modal play |
| `src/components/home/FeaturesRail.js` | Card → modal / play actions |
| `src/components/music/ReleaseCardPlayButton.js:38-58` | Inline play |
| `src/lib/music-playback.js:148-192` | `toPlaybackTrack` |
| `src/lib/music-access.js:214-227` | Stream vs preview URL |
| `src/lib/commerce/catalog.js:3-8` | storage_path gap |
| `src/lib/commerce/entitlements.js:244-253` | `feature` digital |
| `src/app/api/library/stream/route.js:40-70` | 403/404 gate |
| `src/lib/playback/resolve-playback-key.js:73-96` | Key resolution |
| `src/context/AudioContext.js:1248-1296, 1496-1500` | playTrack + F1 fallback |
| `src/lib/playback/stream-client.js:61-101` | Client stream fetch |
| `src/components/preview/ImmersivePreviewModal.js:508-512` | Real AudioContext UI |
