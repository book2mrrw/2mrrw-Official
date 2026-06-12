# Phase 20F — Global media render stability fix (scroll remount elimination)

**Date:** 2026-06-02  
**Mode:** Implementation — minimal surgical React render stabilization  
**Repository:** `/Users/recharge/artist-platform`  
**Prior audits:** `PHASE20D_POST_HYDRATION_UI_STATE_REGRESSION_FORENSIC_AUDIT.md`, `PHASE17_RENDER_ISLAND_AUDIT.md`, `RENDER_PROVIDER_LEAK_AUDIT.md` (no `PHASE20E*.md` on disk — root causes inferred from those audits + codebase)

---

## Executive summary

| Field | Result |
|--------|--------|
| **Primary scroll remount driver** | Mobile home `IntersectionObserver` bumped `homeNavSyncEpoch` → full `page.js` re-render on every section change while scrolling |
| **Secondary drivers** | Unstable list keys (`index` fallbacks), `key={slug}` on `CoverArt`/`img` forcing media remount on carousel/slide change, per-render `withR2CatalogMedia` without memoized card shells |
| **Remount path on scroll** | **Eliminated** for catalog media grids when only scroll-section nav sync changes |
| **Out of scope (unchanged)** | Audio system, routing, entitlements, `page.js` tab architecture, post-hydration catalog URL rewrite (Phase 20D) |

---

## Root causes (from Phase 20D / provider leak audit + code audit)

### 1. Scroll → full Page re-render (critical)

`page.js` used `homeScrollSectionRef` + `setHomeNavSyncEpoch` so `isMobileNavTabActive` could read the current home subsection. `void homeNavSyncEpoch` forced **every** `Page` render when the mobile home IO fired (vault/cards/shows), cascading into `HomeStorefront`, `LatestSinglesStyleRow`, `FeaturesRail`, `CatalogGrid`, and cover/video elements.

**Evidence:** `RENDER_PROVIDER_LEAK_AUDIT.md` — “Scroll adds `setHomeScrollSection` … `G --> E` (full Page re-render).”

### 2. Unstable React keys on media lists

Fallback keys like `` `row-card-${i}` ``, `` `feature-${i}` `` allow identity churn if slug order shifts. `CarouselUI` / `RadioCarousel` used `key={currentSingle.slug}` on `CoverArt` / `img`, **remounting** media on intentional slide change (and amplifying flicker when parent re-rendered).

### 3. No memoization on hot media leaf components

`CoverArt`, row rails, and card shells re-rendered whenever parent `Page` updated, replaying entrance styling risk and resetting video/GIF decode paths.

### 4. Visibility / IO (not unmount, but coupling)

- `AudioVisualsSection`: IO pauses YouTube via `postMessage` — does **not** unmount iframe after first enter (good).
- `usePlaybackCardPrewarm`: IO warms descriptors only — does **not** unmount cards (good).
- Singles row scroll: `syncSinglesCarouselVideos` pauses/plays `<video>` via DOM — no React unmount (by design).

### 5. Phase 20D (separate from scroll)

Post-hydration catalog/auth island updates still change `src` ~1–3s after load (`withR2CatalogMedia` on fetch). **Not fixed in 20F** (backend/catalog policy).

---

## Fixes applied

### Scroll state isolation

| File | Change |
|------|--------|
| `src/lib/home-scroll-section-store.js` | **New** — external store + `subscribe` for home scroll section |
| `src/components/nav/MobileHomeBottomNav.js` | **New** — `useSyncExternalStore`; mobile nav highlight updates without re-rendering `Page` |
| `src/app/page.js` | IO writes to store; removed `homeNavSyncEpoch` / `isMobileNavTabActive`; wired `MobileHomeBottomNav` |

### React key stabilization

| File | Change |
|------|--------|
| `LatestSinglesStyleRow.js` | `key={slug\|id}` only; skip items without stable id |
| `FeaturesRail.js` | Same |
| `CatalogGrid.js` | Require `item.slug`; skip otherwise |
| `CarouselUI.js` | Removed `key={currentSingle.slug}` on `CoverArt` (src swap only) |
| `RadioCarousel.js` | Removed `key={currentSlide.slug}` on cover `img` |

### Component memoization & asset stability

| File | Change |
|------|--------|
| `CoverArt.js` | `memo()`; preload effect keyed on `src`/`type` only |
| `LatestSinglesStyleRow.js` | `memo` row + `SinglesStyleCard` with `useMemo` for `withR2CatalogMedia` / `catalogCoverDisplay` |
| `FeaturesRail.js` | `memo` rail + `FeatureCard` with memoized media resolution |
| `CatalogGrid.js` | `memo()` export |
| `CarouselUI.js` | `memo()` export |
| `PlaybackPrewarmCardShell.js` | `memo()` export |

---

## Remount path confirmation

| Scenario | Before | After |
|----------|--------|-------|
| Scroll home (mobile), IO changes vault/cards/shows | Full `Page` re-render → all storefront media children reconcile | Only `MobileHomeBottomNav` subscribes and re-renders |
| Horizontal scroll singles row | DOM video pause/play only | Unchanged (intentional) |
| Carousel / radio slide change | `CoverArt`/`img` **remounted** via `key={slug}` | **Src update** on same instance |
| Tab away from home | `HomeStorefront` unmount (Phase 17) | Unchanged |

---

## Files changed

- `src/lib/home-scroll-section-store.js` (new)
- `src/components/nav/MobileHomeBottomNav.js` (new)
- `src/app/page.js`
- `src/components/ui/CoverArt.js`
- `src/components/home/LatestSinglesStyleRow.js`
- `src/components/home/FeaturesRail.js`
- `src/components/home/CatalogGrid.js`
- `src/components/home/CarouselUI.js`
- `src/components/home/RadioCarousel.js`
- `src/components/music/PlaybackPrewarmCardShell.js`
- `docs/audits/PHASE20F_GLOBAL_MEDIA_RENDER_STABILITY_FIX.md` (this file)

---

## Validation

```bash
npm run build
npm run check:frontend-guardrails
```

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** (Next.js 16.2.4, compiled ~5.6s) |
| `npm run check:frontend-guardrails` | **PASS** — 0 errors, 3 pre-existing warnings on `page.js` markers |

---

## Follow-ups (not in 20F)

- Phase 20D: gate or stabilize catalog media URLs after `/api/catalog/releases` hydration.
- Optional: extract `syncSinglesCarouselVideos` to a ref callback to avoid any future scroll-linked React state.
- `page.js` cart/modal `key={i}` rows — out of media-grid scope.
