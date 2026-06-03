# Phase P11B — Storefront-Wide MP4 Source Integrity Coverage

> **2026-06-03:** Verified intact on P12 baseline (`d1617e2`). See [PHASE_P11_RESTORE_ON_P12.md](./PHASE_P11_RESTORE_ON_P12.md).

**Date:** 2026-06-03  
**Repository:** `/Users/recharge/artist-platform`  
**Builds on:** Phase P11 (`c9aa914`) — `resolve-concrete-video-key.js` + `catalogMotionVideoUrl()`  
**Scope:** MP4 source integrity only — singles carousel, features rail, albums grid, mixtapes/EPs row; future-proof flat→nested resolution  

---

## Executive verdict

| Field | Result |
|-------|--------|
| **Extension** | Resolver now covers all release folders (`singles`, `features`, `albums`, `mixtapes-and-eps`) + slug/stem heuristics for albums/mixtapes |
| **Turnt Me 2 Dis** | Flat `videos/singles/turntme2dis.mp4` → nested `videos/singles/turnt-me-2-dis/turntme2dis.mp4` (**200**) |
| **Unified paths** | `CatalogGrid` + `normalizeTrackForPlayback` now route through `catalogCoverDisplay` / `catalogMotionVideoUrl` with slug + `video_legacy` |
| **Future releases** | `deriveNestedVideoKeyFromFlatPath()` builds nested key from flat path + slug without per-title code |
| **Build** | `npm run build` — **PASS** |
| **Guardrails** | `npm run check:frontend-guardrails` — **PASS** (0 errors, 3 pre-existing warnings) |

---

## Turnt Me 2 Dis — before / after

| Step | Value |
|------|-------|
| Slug | `turnt-me-2-dis` |
| Canonical `legacy_video_stem` | `turntme2dis` |
| Inline fallback (`page.js`) | `video: "/videos/singles/turntme2dis.mp4"` |
| **Before (broken)** | `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/videos/singles/turntme2dis.mp4` → **404** |
| **After (fixed)** | `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev/videos/singles/turnt-me-2-dis/turntme2dis.mp4` → **200** `video/mp4` |

Resolver chain: flat stem `turntme2dis` matches `CANONICAL_SINGLES[].legacy_video_stem` → slug `turnt-me-2-dis` → `legacyVideoPublicPath("single", "turnt-me-2-dis", "turntme2dis")`.

---

## Unified code paths (single resolver entry)

All motion MP4 assignment must flow through `catalogMotionVideoUrl()` → `resolveConcreteVideoR2Key()`:

| Surface | File | Mechanism |
|---------|------|-----------|
| Latest Singles carousel | `LatestSinglesStyleRow.js` | `withR2CatalogMedia` → `mediaItem.video` |
| Features rail | `FeaturesRail.js` | `catalogCoverDisplay(withR2CatalogMedia(item))` |
| Albums grid | `CatalogGrid.js` | **P11B:** `catalogCoverDisplay(withR2CatalogMedia(item))` (was raw `item.cover`) |
| Mixtapes & EPs row | `LatestSinglesStyleRow.js` (`cardMedia="cover"`) | `withR2CatalogMedia` + `catalogCoverDisplay` fallback in cover path |
| R2 catalog merge | `r2-catalog-media.js` | `catalogMotionVideoUrl(videoRaw, { slug, legacyKey: video_legacy })` |
| Cover display helper | `catalogMedia.js` | `catalogMotionVideoUrl(..., { slug, legacyKey: video_legacy })` |
| Playback normalization | `music-playback.js` | **P11B:** `catalogMotionVideoUrl(..., { slug, legacyKey: video_legacy })` |
| Release card chrome | `ReleaseCardPlayButton.js` | `catalogCoverDisplay(item)` |
| Radio / carousel preload | `page.js` | `catalogCoverDisplay(withR2CatalogMedia(item))` |

**No duplicate URL builders** bypass the resolver for storefront catalog motion video.

---

## Resolver extensions (P11B)

| Capability | Implementation |
|------------|----------------|
| Albums / mixtapes slug lookup | `CANONICAL_ALBUMS` included in `resolveCanonicalSlugFromFlatVideoKey` |
| Release-folder scoping | `extractReleaseTypeFolderFromFlatVideoKey` — flat path folder must match release type when known |
| Stem matching | `legacy_video_stem`, `legacy_cover_stem`, slug, de-hyphenated slug |
| Future releases | `deriveNestedVideoKeyFromFlatPath(flatPath, slug)` when canonical row absent but slug known |
| Direct nested keys | `video_legacy` from `mergeCanonicalMetadata` preferred when already nested |

---

## Convention for new releases

When adding a single, feature, album, or mixtape/EP with motion loop video:

1. **R2 layout:** `videos/{release-folder}/{slug}/{stem}.mp4`  
   - `{release-folder}`: `singles` | `features` | `albums` | `mixtapes-and-eps`  
   - `{slug}`: URL-safe catalog slug (e.g. `turnt-me-2-dis`)  
   - `{stem}`: legacy filename stem when flat paths differ (e.g. `turntme2dis`)

2. **Canonical catalog** (`canonical-catalog.js`): set `legacy_video_stem` when stem ≠ de-hyphenated slug.

3. **Inline / API fallback:** flat path `videos/{folder}/{stem}.mp4` is OK — resolver normalizes automatically.

4. **No per-title code:** pass `slug` + optional `video_legacy` into `catalogMotionVideoUrl`; do not hand-build CDN URLs.

Example new single:

```javascript
// canonical-catalog.js
{ slug: "new-drop", legacy_video_stem: "newdrop", release_type: "single", ... }

// page.js inline (optional)
{ slug: "new-drop", video: "/videos/singles/newdrop.mp4", ... }
// → resolves to videos/singles/new-drop/newdrop.mp4
```

---

## curl HEAD verification

CDN base: `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev`

### Singles (fixed nested keys — all PASS)

| Release | Resolved key | HTTP | Content-Type | Result |
|---------|--------------|------|--------------|--------|
| Hour Glass | `videos/singles/hour-glass/hourglass.mp4` | 200 | video/mp4 | PASS |
| W.2.D | `videos/singles/w2d/w2d.mp4` | 200 | video/mp4 | PASS |
| ArTiFiCiAL | `videos/singles/artificial/artificial.mp4` | 200 | video/mp4 | PASS |
| Turnt Me 2 Dis | `videos/singles/turnt-me-2-dis/turntme2dis.mp4` | 200 | video/mp4 | PASS |

### Flat legacy controls (still 404 — expected)

| Flat path | HTTP |
|-----------|------|
| `videos/singles/hourglass.mp4` | 404 |
| `videos/singles/turntme2dis.mp4` | 404 |

### Features / albums / mixtapes (resolver-ready; objects not yet on R2)

| Pattern | Example nested key | HTTP | Notes |
|---------|-------------------|------|-------|
| Feature | `videos/features/i-dont-believe-you/i-dont-believe-you.mp4` | 404 | Resolver produces correct key; upload pending |
| Mixtape | `videos/mixtapes-and-eps/ad/ad.mp4` | 404 | Same |
| Mixtape track | `videos/mixtapes-and-eps/07-a2b/07-a2b.mp4` | 404 | Track-level pattern supported |

Only singles currently have motion MP4 objects on public R2. Features/albums/mixtapes use image covers today; when motion loops ship, flat legacy paths will resolve without code changes.

---

## Files changed (P11B)

| File | Change |
|------|--------|
| `src/lib/media/resolve-concrete-video-key.js` | Albums/mixtapes slug lookup; release-folder scoping; `deriveNestedVideoKeyFromFlatPath` |
| `src/lib/music-playback.js` | Pass `slug` + `video_legacy` to `catalogMotionVideoUrl` |
| `src/components/home/CatalogGrid.js` | Route cover/video through `withR2CatalogMedia` + `catalogCoverDisplay` |
| `docs/audits/PHASE_P11B_STOREFRONT_MP4_COVERAGE.md` | This report |

---

## Build & guardrails

```
npm run build — ✓ Compiled successfully
npm run check:frontend-guardrails — 0 error(s), 3 warning(s) (pre-existing page.js markers)
```

---

## Artifacts

| Artifact | Path |
|----------|------|
| P11 baseline | `docs/audits/PHASE_P11_MP4_SOURCE_INTEGRITY_REPAIR.md` |
| P11B report | `docs/audits/PHASE_P11B_STOREFRONT_MP4_COVERAGE.md` |
| ZIP bundle | `/Users/recharge/Downloads/PHASE_P11B_STOREFRONT_MP4_COVERAGE.zip` |
