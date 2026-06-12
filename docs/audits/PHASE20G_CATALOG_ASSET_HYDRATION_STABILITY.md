# Phase 20G — Catalog asset hydration stability & cover art URL churn fix

**Date:** 2026-06-02  
**Mode:** Implementation — surgical asset-source stabilization only  
**Repository:** `/Users/recharge/artist-platform`  
**Prior audits:** `PHASE20D_POST_HYDRATION_UI_STATE_REGRESSION_FORENSIC_AUDIT.md`, `PHASE20F_GLOBAL_MEDIA_RENDER_STABILITY_FIX.md`

---

## Executive summary

| Field | Result |
|--------|--------|
| **Dominant root cause** | Page-1 catalog fetch unconditionally re-ran `withR2CatalogMedia()` after first paint while `mergeCanonicalMetadata()` preferred canonical discovery URLs over inline storefront paths, producing new `cover`/`video`/`src` strings for the same entities ~1–3s post-load. |
| **Fix strategy** | Stabilize media on provider init; idempotent R2 rewrite + per-slug memo; prefer inline media on API merge; skip `setBrowseSingles` when media signatures unchanged; prefer item media over canonical enrichment when both exist. |
| **20F scroll stability** | **Unchanged** — no edits to `home-scroll-section-store.js`, `MobileHomeBottomNav.js`, or scroll IO in `page.js`. |

---

## Root cause (single dominant)

**H1 + H3:** Coalesced page-1 catalog hydration rewrote all inline media through `withR2CatalogMedia()` after first paint, and `mergeCanonicalMetadata()` replaced working `/images/` / `/videos/` paths with `/api/media/visual?…` discovery URLs before CDN resolution — so `CoverArt` and `<video>` received a second, different `src`/`poster` even when the React tree did not remount (Phase 20F).

Secondary contributors (not primary): API merge overwriting inline with empty/broken CDN fields (H3/H4); redundant double resolution in `catalogCoverDisplay` (mitigated by idempotent `withR2CatalogMedia`).

---

## Hydration timeline (after 20G)

| Time | Event | UI effect |
|------|--------|-----------|
| **0.0s** | `CatalogSurfaceProvider` mounts | `browseSingles` = `stabilizeCatalogMediaList(inline)` — final display URLs computed once |
| **0.0s** | Cards render via memoized `withR2CatalogMedia` / `catalogCoverDisplay` | Same URL pipeline as provider seed; inline paths preserved over canonical discovery when present |
| **~1–3s** | `GET /api/catalog/releases?page=1` completes | `commitBrowseSinglesIfChanged` — **no state update** if media signatures match stabilized inline |
| **~1–3s** | API tracks with new slugs only | Immutable append; per-track `mergeCatalogTrackWithInline` preserves inline cover/video when API fields are weaker |

Auth/entitlement second paint (admin gift gate) remains as documented in Phase 20D — out of 20G scope.

---

## Fixes applied

### 1. Stabilize media URLs (`src/lib/media/r2-catalog-media.js`)

- `catalogMediaSignature` / `catalogSinglesMediaEqual` — skip redundant React state when URLs unchanged.
- `mergeCatalogTrackWithInline` — preserve inline `/images|videos|audio/` and resolved URLs when API merge would regress.
- `withR2CatalogMedia` — idempotent `resolveCatalogMediaField`; per-slug memo cache.
- `stabilizeCatalogMediaList` — one deterministic pass for provider seed.

### 2. Prefer storefront inline in canonical enrichment (`canonical-catalog.js`)

- `mergeCanonicalMetadata`: `item.cover || release.cover` (and visual/video/preview) so inline constants are not replaced by discovery URLs before R2 rewrite.

### 3. Catalog surface provider (`catalog-surface-context.js`)

- Initial `browseSingles` from stabilized inline seed (not raw then rewrite on fetch).
- Page-1 fetch paths use `commitBrowseSinglesIfChanged` + `stabilizedInlineSingles` ref.
- API track merge uses `mergeCatalogTrackWithInline` + `withR2CatalogMedia`.

### 4. One pipeline / no post-render mutation

- Consumers still call `withR2CatalogMedia` / `catalogCoverDisplay`; re-entries hit memo + idempotent resolvers — no new URL strings for unchanged inputs.

### 5. Cover art / video src churn

- Inline paths win over canonical discovery; API cannot clobber working inline media; fetch completion does not force state update when signatures match.

---

## SSR / client parity

- Home `page.js` is `"use client"`; catalog cards are not SSR-rendered with divergent media URLs.
- First client paint and post-fetch state share the same stabilization path (`stabilizeCatalogMediaList` + idempotent `withR2CatalogMedia`).
- No post-hydration in-place mutation of catalog objects — `setBrowseSingles` returns previous array reference when `catalogSinglesMediaEqual` is true.

---

## Files changed

| File | Change |
|------|--------|
| `src/lib/media/r2-catalog-media.js` | Idempotent rewrite, inline merge, signature equality, slug memo |
| `src/lib/media/canonical-catalog.js` | Prefer item media fields over canonical discovery in `mergeCanonicalMetadata` |
| `src/components/storefront/catalog-surface-context.js` | Stabilized initial state; conditional page-1 commits; inline-aware API merge |
| `docs/audits/PHASE20G_CATALOG_ASSET_HYDRATION_STABILITY.md` | This document |

**Not changed (20F):** `src/lib/home-scroll-section-store.js`, `src/components/nav/MobileHomeBottomNav.js`, scroll-related `page.js` wiring, `CoverArt.js` memo (20F), home row memoization.

---

## Validation

```bash
npm run build
npm run check:frontend-guardrails
```

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** (Next.js 16.2.4) |
| `npm run check:frontend-guardrails` | **PASS** (0 errors; pre-existing `page.js` marker warnings) |

---

## Follow-ups (out of scope)

- Auth island: stabilize `isAdminStable` flicker (Phase 20D item 2).
- Narrow `PageStorefront` auth subscription to reduce non-media re-renders.
- Device validation on Mobile Safari with hydration trace flags.
