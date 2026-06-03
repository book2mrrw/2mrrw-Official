# Phase P11 — MP4 Source Integrity Repair

> **2026-06-03:** Verified intact on P12 baseline (`d1617e2`). See [PHASE_P11_RESTORE_ON_P12.md](./PHASE_P11_RESTORE_ON_P12.md).  
**Repository:** `/Users/recharge/artist-platform`  
**Scope:** Storefront MP4 cover/loop source integrity only — no auth, reconciliation, hydration retries, or reload hardening  
**P10B input:** React remount falsified; `MEDIA_ELEMENT_ERROR` code 4 on mounted carousel `<video>` nodes; wrong flat R2 paths 404 while entity-folder paths 200  

---

## Executive verdict

| Field | Result |
|-------|--------|
| **First broken link** | `catalogMotionVideoUrl()` in `src/lib/media-urls.js` — flat legacy paths (`videos/singles/{stem}.mp4`) passed through to R2 CDN without entity-slug folder normalization |
| **Fix location** | New `resolve-concrete-video-key.js` (mirrors preview resolver); wired into `catalogMotionVideoUrl`, `withR2CatalogMedia`, `catalogCoverDisplay` |
| **Broken → fixed pattern** | `videos/singles/hourglass.mp4` → `videos/singles/hour-glass/hourglass.mp4` |
| **Build** | `npm run build` — **PASS** (Next.js 16.2.4, compiled in 4.8s) |
| **Guardrails** | `npm run check:frontend-guardrails` — **PASS** (0 errors, 3 pre-existing warnings in `page.js`) |

---

## Per-release URL chain

### Hour Glass (`hour-glass`)

| Step | Path / value |
|------|----------------|
| 1. DB / catalog | Slug `hour-glass`; R2 key `videos/singles/hour-glass/hourglass.mp4` (`.tmp-final-playback-validation-20260528/r2-verify.json`) |
| 2. Canonical metadata | `legacy_video_stem: "hourglass"` → `video_legacy: videos/singles/hour-glass/hourglass.mp4` (`canonical-catalog.js`) |
| 3. Inline fallback (`page.js`) | `video: "/videos/singles/hourglass.mp4"` — flat legacy path |
| 4. API visual (when used) | `/api/media/visual?releaseType=single&slug=hour-glass&legacyVideo=videos/singles/hour-glass/hourglass.mp4` |
| 5. Mapper (`withR2CatalogMedia`) | **Before:** `catalogMotionVideoUrl("videos/singles/hourglass.mp4")` → flat R2 URL **404** |
| 6. Mapper (after fix) | `resolveConcreteVideoR2Key` → `videos/singles/hour-glass/hourglass.mp4` → R2 URL **200** |
| 7. Card renderer | `LatestSinglesStyleRow` → `SinglesStyleCardMediaSurface` → `video.src` |
| 8. curl HEAD (fixed) | **200** `video/mp4` **1,104,855** bytes — **PASS** |

### W.2.D (`w2d`)

| Step | Path / value |
|------|----------------|
| 1. DB / catalog | Slug `w2d`; R2 key `videos/singles/w2d/w2d.mp4` |
| 2. Canonical metadata | `video_legacy: videos/singles/w2d/w2d.mp4` |
| 3. Inline fallback | `video: "/videos/singles/w2d.mp4"` |
| 4. Mapper (before) | Flat `videos/singles/w2d.mp4` → R2 **404** |
| 5. Mapper (after) | `videos/singles/w2d/w2d.mp4` → R2 **200** |
| 6. curl HEAD (fixed) | **200** `video/mp4` **999,729** bytes — **PASS** |

### ArTiFiCiAL (`artificial`)

| Step | Path / value |
|------|----------------|
| 1. DB / catalog | Slug `artificial`; R2 key `videos/singles/artificial/artificial.mp4` |
| 2. Canonical metadata | `video_legacy: videos/singles/artificial/artificial.mp4` |
| 3. Inline fallback | `video: "/videos/singles/artificial.mp4"` |
| 4. Mapper (before) | Flat `videos/singles/artificial.mp4` → R2 **404** |
| 5. Mapper (after) | `videos/singles/artificial/artificial.mp4` → R2 **200** |
| 6. curl HEAD (fixed) | **200** `video/mp4` **2,605,938** bytes — **PASS** |

---

## Broken flat paths (control — still 404)

| URL | Status |
|-----|--------|
| `.../videos/singles/hourglass.mp4` | **404** |
| `.../videos/singles/w2d.mp4` | **404** |
| `.../videos/singles/artificial.mp4` | **404** |

---

## Root cause

Storefront inline singles (`src/app/page.js`) and merge logic preserve flat legacy paths like `/videos/singles/hourglass.mp4`. R2 stores motion loops under entity folders (`videos/singles/{slug}/{stem}.mp4`). `catalogMotionVideoUrl()` treated any `videos/` path as a direct R2 key, producing 404 URLs that surface as `MEDIA_ELEMENT_ERROR` code 4 on mounted `<video>` nodes (P10B).

Preview audio already had flat-key normalization via `resolve-concrete-preview-key.js`. Video had no equivalent until P11.

---

## Files changed

| File | Change |
|------|--------|
| `src/lib/media/resolve-concrete-video-key.js` | **New** — flat legacy video key detection + canonical slug/stem → nested R2 key |
| `src/lib/media-urls.js` | `catalogMotionVideoUrl()` calls `resolveConcreteVideoR2Key`; accepts optional `slug` / `legacyKey` |
| `src/lib/media/r2-catalog-media.js` | Passes slug + `video_legacy` into `catalogMotionVideoUrl` |
| `src/components/home/catalogMedia.js` | Passes slug + `video_legacy` in `catalogCoverDisplay` |
| `src/components/home/LatestSinglesStyleRow.js` | Trace: `MEDIA_SRC_ASSIGNED`, `MEDIA_ELEMENT_ERROR` (gated by `NEXT_PUBLIC_UI_HYDRATION_TRACE=1`) |

**Storefront-wide:** Any surface calling `catalogMotionVideoUrl` or `withR2CatalogMedia` receives the fix (Latest Singles carousel, cover display, playback normalization).

---

## Trace events (gated)

Enable: `NEXT_PUBLIC_UI_HYDRATION_TRACE=1`

| Event | When |
|-------|------|
| `MEDIA_SRC_ASSIGNED` | Carousel video surface mount — logs slug + resolved URL |
| `MEDIA_ELEMENT_ERROR` | `<video error>` — logs slug, src, currentSrc, MediaError code |
| `MEDIA_CARD_REINITIALIZED` | Existing P9 mount trace |

---

## Validation evidence

### Node resolver smoke (post-fix)

```
hour-glass:  in /videos/singles/hourglass.mp4  → .../hour-glass/hourglass.mp4
w2d:         in /videos/singles/w2d.mp4         → .../w2d/w2d.mp4
artificial:  in /videos/singles/artificial.mp4  → .../artificial/artificial.mp4
```

### Build

```
npm run build — ✓ Compiled successfully in 4.8s
```

### Guardrails

```
npm run check:frontend-guardrails — 0 error(s), 3 warning(s) (pre-existing page.js markers)
```

### curl HEAD (fixed URLs)

| Release | HTTP | Content-Type | Size | Result |
|---------|------|--------------|------|--------|
| Hour Glass | 200 | video/mp4 | 1,104,855 | PASS |
| W.2.D | 200 | video/mp4 | 999,729 | PASS |
| ArTiFiCiAL | 200 | video/mp4 | 2,605,938 | PASS |

### Browser (production)

Production `www.2mrrw.com` still serves pre-P11 bundle until deploy. Local resolver + curl confirm fix logic; live carousel verification pending deploy.

---

## P10B correlation

| P10B finding | P11 resolution |
|--------------|----------------|
| Nodes stay mounted (`sameRef: true`) | Unchanged — fix is src integrity only |
| Error 4 on all carousel videos | Caused by 404 flat R2 paths |
| Correct API path decodes (200) | Now used as resolved `video.src` |
| No src change over 48s | Expected — wrong src was stable from first paint |

---

## Artifacts

| Artifact | Path |
|----------|------|
| This report | `docs/audits/PHASE_P11_MP4_SOURCE_INTEGRITY_REPAIR.md` |
| ZIP bundle | `/Users/recharge/Downloads/PHASE_P11_MP4_SOURCE_INTEGRITY_REPAIR.zip` |
| P10B reference | `docs/audits/PHASE_P10B_LIVE_RUNTIME_PROOF.md` |
