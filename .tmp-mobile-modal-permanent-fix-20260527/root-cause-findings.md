# Root Cause Findings — Mobile Modal & Account Crashes

**Date:** 2026-05-27  
**Commit:** `db88530`  
**Deploy:** `dpl_3STkrSuFwUchTvtNmhDyux1XGobP` → https://www.2mrrw.com

## Summary

Mobile "Something went wrong" came from **uncaught render throws** in `src/app/page.js` (account tab) bubbling to Next.js `src/app/error.js`. V9 immersive modals were **not** wrapped in `ModalErrorBoundary`, so any modal render error also hit the route error boundary.

## Confirmed root causes

### 1. Account tab avatar initial (primary)

| Item | Detail |
|------|--------|
| **File** | `src/app/page.js` ~2363 (pre-fix) |
| **Throw** | `currentUser.name[0].toUpperCase()` when `name` is `""` or missing |
| **Symptom** | Full-page `error.js`: "Something went wrong" after More → My Account |
| **Note** | Mobile nav sheet already used safe `accountDisplayInitial` (~1507); account **tab** did not |

### 2. Modals unbounded to route error boundary

| Item | Detail |
|------|--------|
| **Files** | `src/app/page.js` ~1558–1608 — `ImmersivePreviewModal`, `AlbumModal` |
| **Gap** | No `ModalErrorBoundary` (unlike nav sheet, cart, Stripe overlay) |
| **Symptom** | Any modal render error → `src/app/error.js` instead of dismissible panel |

### 3. Modal input validation (secondary)

| Item | Detail |
|------|--------|
| **File** | `src/components/preview/ImmersivePreviewModal.js` default export |
| **Risk** | Opening modal with release missing `slug`/`id` could propagate bad track shape |
| **Album** | Empty/malformed `tracks` array — no throw, but fragile `activeTrack` state |

## Ruled out / already safe

- **`useCoverPalette`**: Already falls back to `DEFAULT_PALETTE` on missing cover (`src/hooks/useCoverPalette.js` ~207–209).
- **`useMediaEngine`**: Does not throw on missing track; maps null safely (`src/media/useMediaEngine.js`).
- **Provider order**: `AuthProvider` → `AudioProvider` in `src/app/layout.js` — modals run under `AudioProvider`.
- **No `/account` route**: Account is inline tab only (audit correct); fix is in tab JSX, not routing.

## Error string map

| User copy | Source | Catches |
|-----------|--------|---------|
| "Something went wrong" | `src/app/error.js:42` | Uncaught errors in `page.js` tree |
| "Something went wrong in this view." | `src/system/errors/ErrorBoundary.js:60` | Generic boundary |
| "This panel could not load…" | `ModalErrorFallback` (new) | Modal boundary after fix |
