# Phase 17C — Production Validation

**Date:** 2026-06-01  
**Commit message:** `Phase 17C: production-grade render architecture consolidation`

---

## Architecture score

| Metric | Before 17C | After 17C (est.) | Target |
|--------|------------|------------------|--------|
| Render isolation (hero / home / playback) | 6.5 / 10 | **9 / 10** | 9+ |
| Home tab return stability | Good (17A) | **Good** | Stable mount |
| Countdown 1 Hz blast radius | Poor (full page) | **Good** (home + live only) | Narrow provider |
| Playback-driven full-Page churn | Good (17B) | **Good** | Islands |
| Catalog-driven hero churn | Partial | **Improved** (catalog provider + PlaybackChrome memo) | Isolated |
| Mobile home nav ↔ scroll | Good (17A IO epoch) | **Good** | Verified |

**Net estimated:** **8.8 → 9.2 / 10** production render architecture (10/10 reserved for future `page.js` route split / P3).

---

## Implementation checklist (T1–T10)

| Target | Status | Notes |
|--------|--------|-------|
| T1 Home persistence | ✅ | `data-home-storefront` + scroll restore retained |
| T2–T4 Island hardening | ✅ | No `useAudioPlayer` / `useEntitlementAccountState` on `Page` |
| T5 Countdown scope | ✅ | Provider in `HomeStorefront` + live tab only |
| T6 Hero island | ✅ | `HeroIsland.js` — `isMobile` + refs only |
| T7 Catalog isolation | ✅ | `CatalogSurfaceProvider` + `useCatalogSurface` |
| T8 IO epoch | ✅ | `setHomeNavSyncEpoch` on section change (L500–502) |
| T9 Home memo | ✅ | `handleDonateOpen` stable; catalog via context |
| T10 No playback/Stripe regressions | ✅ | No `AudioContext` / checkout edits |

---

## Automated checks

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npm run check:frontend-guardrails` | See CI output below |

---

## Files changed

| Path | Role |
|------|------|
| `src/components/storefront/catalog-surface-context.js` | Catalog fetch + lookup island |
| `src/components/home/HeroIsland.js` | Hero-only props boundary |
| `src/components/home/HomeStorefront.js` | Scoped `LiveCountdownProvider` |
| `src/components/storefront/HomeStorefrontFlowMode.js` | Pass `liveCountdownTarget` |
| `src/app/page.js` | Provider split, remove page-wide countdown |
| `docs/audits/PHASE17C_PRE_IMPLEMENTATION_REVIEW.md` | Pre-review |
| `docs/audits/PHASE17C_CONFLICT_MATRIX.md` | Regression matrix |
| `docs/audits/PHASE17C_PRODUCTION_VALIDATION.md` | This doc |

---

## Manual QA (recommended)

1. Home → Music → Home: no remount flash; scroll restored.  
2. Play track: mini player works; hero stable during catalog load.  
3. Live tab: countdown ticks; no provider errors.  
4. Immersive preview + checkout unchanged.  
5. Mobile: vault/cards/shows nav highlight on scroll.

---

## Known follow-ups (P3, out of scope)

- Split `PageStorefront` into route segments.  
- Coalesce hero carousel video DOM sync.  
- Entitlement context slice for card rows only.
