# Phase R1 — ROOT Application Reconcile Elimination

**Repository:** `/Users/recharge/artist-platform`  
**Date:** 2026-06-03  
**Scope:** Implementation (not audit-only). Preserves phases 17A–17C, 18A–18C, 19, 20C, 20F–20G, 20H, 21A–21C.

---

## 1. Files modified

| File | Part |
|------|------|
| `src/app/page.js` | A — removed `useAuth()` from `PageStorefront`; auth via ref + leaf islands |
| `src/lib/storefront/page-auth-ref.js` | A — imperative auth snapshot for stable callbacks |
| `src/components/storefront/PageAuthRefSync.js` | A, E — sync ref + `AUTH_BOOTSTRAP_COMPLETE` trace |
| `src/components/storefront/PageAuthRegions.js` | A — sidebar/mobile/account/community auth leaves |
| `src/components/auth/AppAuthRoot.js` | B — additive hydration overlay; auth-route gate exempt |
| `src/components/storefront/catalog-surface-context.js` | C, E — split `catalogLoading` context; `CATALOG_LOADING_COMPLETE` |
| `src/components/home/HomeStorefront.js` | C, E — loading skeleton island; `HOME_STOREFRONT_RENDER` |
| `src/components/home/CarouselUI.js` | D — mount/slug-gated enter animations |
| `src/components/home/FeaturesRail.js` | D, E — mount-gated `fadeInUp`; `FEATURES_RAIL_RENDER` |
| `src/components/home/LatestSinglesStyleRow.js` | D, E — mount-gated `catalog-card-enter`; `LATEST_SINGLES_RENDER` |
| `src/lib/diagnostics/ui-hydration-trace.js` | E — `NEXT_PUBLIC_UI_HYDRATION_TRACE=1` events |
| `src/hooks/useMountEnterAnimation.js` | D — one-shot enter animation helper |

**Not modified:** `AudioContext.js`, `AuthGate.js` (overlay behavior unchanged; gate exempt is in `AppAuthRoot`).

---

## 2. Root cause fixed per file

| Root cause | Fix |
|------------|-----|
| **#1 PageStorefront `useAuth()`** | `PageStorefront` no longer subscribes to `AuthProvider`. `PageAuthRefSync` updates `pageAuthRef` for imperative cart/playback/checkout. Home/music/catalog chrome use existing `AuthSurfaceIsland` / `EntitlementSurfaceIsland`. Community/account/cart use `PageAuthSessionBridge` leaves. |
| **#2 `catalogLoading` broad rerenders** | `catalogLoading` removed from `useCatalogSurface()` value. `useCatalogLoading()` + `CatalogLatestSinglesLoadingExtras` isolate skeleton/load-more subscribers. |
| **#3 AppAuthRoot placeholder swap** | Route `children` always mounted; boot placeholder is fixed overlay (`visibility` / `pointer-events: none`) — mount count 1 per session. |
| **#4 Entitlement through large regions** | Unchanged island boundaries; Page shell no longer reconciles on entitlement commit. |
| **#5 Animation replay** | `useMountEnterAnimation` / `useSlugEnterAnimation` gate `fadeInCover`, `fadeInUp`, `catalog-card-enter`, carousel title motion. |

---

## 3. Before / after render path

### Before (cold home)

```
Auth bootstrap → AuthProvider value change
  → PageStorefront (useAuth) full reconcile
  → Hero + HomeStorefront + Latest Singles + Features + carousel props/callbacks
  → catalogLoading flip → second reconcile
  → fadeInCover / catalog-card-enter replay (visual “reload”)
```

First paint: `AppAuthRoot` returned placeholder **instead of** `children` → one subtree remount when `hydrated`.

### After (cold home)

```
Auth bootstrap → PageAuthRefSync updates ref only (null render)
  → PageStorefront does NOT re-render on auth
  → EntitlementSurfaceIsland / AuthSurfaceIsland on home update CTA/access only
  → CatalogLatestSinglesLoadingExtras re-renders on catalogLoading only
  → Hero / row cards stable unless catalog data or island entitlement props change
```

First paint: `children` always mounted; boot overlay only.

---

## 4. Trace evidence notes

Enable: `NEXT_PUBLIC_UI_HYDRATION_TRACE=1` or `NEXT_PUBLIC_PLAYBACK_TRACE=1` (dev).

| Event | Source |
|-------|--------|
| `AUTH_BOOTSTRAP_COMPLETE` | `PageAuthRefSync.js` when `sessionHydrated && !loading` |
| `CATALOG_LOADING_COMPLETE` | `catalog-surface-context.js` page-1 fetch `finally` |
| `PAGESTOREFRONT_RENDER` | `page.js` `PageStorefront` (tab changes only — not auth bumps) |
| `HOME_STOREFRONT_RENDER` | `HomeStorefront.js` |
| `LATEST_SINGLES_RENDER` | `LatestSinglesStyleRow.js` |
| `FEATURES_RAIL_RENDER` | `FeaturesRail.js` |

**Expected ordering (cold load):** `PAGESTOREFRONT_RENDER` (initial) → `HOME_STOREFRONT_RENDER` / `LATEST_SINGLES_RENDER` / `FEATURES_RAIL_RENDER` (initial) → `AUTH_BOOTSTRAP_COMPLETE` → island churn logs (`auth-surface-island`, `entitlement-surface-island`) **without** duplicate `PAGESTOREFRONT_RENDER` → `CATALOG_LOADING_COMPLETE` → optional skeleton island render only.

Existing: `HOME_STOREFRONT_MOUNT` count 1 via `NEXT_PUBLIC_PLAYBACK_TRACE=1` in `page.js`.

---

## 5. Build / guardrail results

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npm run check:frontend-guardrails` | **PASS** (0 errors; 3 pre-existing page.js marker warnings) |

---

## Hardening preservation

| Phase | Status |
|-------|--------|
| 17A home persist `display:none` | Preserved |
| 17B/17C islands + catalog provider | Strengthened (R1 completes island intent) |
| 18A–18C, 19, 20C, 21A–21C playback | Untouched |
| 20F scroll store | Untouched |
| 20G/20H catalog determinism | Untouched (fetch/commit logic unchanged) |
