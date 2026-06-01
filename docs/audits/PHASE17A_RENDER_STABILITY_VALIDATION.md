# Phase 17A — P0 Render Stability Validation

**Date:** 2026-06-01  
**Scope:** `src/app/page.js`, `src/components/home/HomeStorefront.js` (wrapper only in `page.js`)  
**Reference:** `docs/audits/PHASE17_RENDER_ISLAND_AUDIT.md` (P0 section)

---

## P0 items implemented

| ID | Change | Files |
|----|--------|-------|
| P0-1 | Removed stale `setHomeScrollSection(null)` from `switchTab`; nav uses `homeScrollSectionRef` + `homeNavSyncEpoch`; IO bumps epoch on section change | `page.js` |
| P0-2 / P0-4 | `HomeStorefront` stays mounted; wrapper `data-home-storefront` uses `display: none` when `activeTab !== "home"` | `page.js` |
| P0-3 | Save `mainScrollRef.scrollTop` and `singlesRowRef.scrollLeft` when leaving home; restore on return via `requestAnimationFrame` | `page.js` |
| P0-5 | Trace events gated by `isPlaybackTraceEnabled()` (`NEXT_PUBLIC_PLAYBACK_TRACE=1` or dev): `HOME_STOREFRONT_MOUNT` / `UNMOUNT`, `HOME_TAB_HIDDEN` / `VISIBLE`, `HOME_SCROLL_RESTORED` | `page.js` |

---

## Before (from Phase 17 audit — theoretical)

### Tab switch correctness

- `switchTab` called **`setHomeScrollSection(null)`** with no matching `useState` → **ReferenceError risk** or dead incomplete Phase 16 cleanup.
- IntersectionObserver wrote **`homeScrollSectionRef` only**; mobile nav vault/cards/shows highlight could stay stale until an unrelated `Page` re-render (epoch not bumped on IO match).

### Home tab “refresh” symptom

- `{activeTab === "home" && <HomeStorefront />}` **unmounted** the entire home subtree when visiting Music, Shop, Vault, etc.
- Returning to Home **remounted**: carousel `<video>` restart, `FeaturesRail` / card entrance animations replayed, layout shift.
- Catalog fetch was **not** re-triggered by tab alone (`catalogPage` effect), but **visual refresh** dominated perceived behavior.

### Scroll

- No dedicated save/restore of main column scroll or singles row horizontal scroll across tab changes.
- Shared `mainScrollRef` kept whatever scroll position the last tab left — home position was **lost** when returning.

### Trace

- No Phase 17A home-mount / tab-visibility / scroll-restore trace events.

---

## After (implementation)

### Tab switch correctness

- `switchTab` only updates `activeTab` and nav chrome; **no** `setHomeScrollSection`.
- IO still updates `homeScrollSectionRef`; on section change **`setHomeNavSyncEpoch(n => n + 1)`** so `isMobileNavTabActive` re-reads ref.
- Leaving home still clears `homeScrollSectionRef` via existing `activeTab` effect; epoch still bumps on tab change.

### Home tab persistence

- `HomeStorefront` is **always mounted** inside `[data-home-storefront]`; hidden with **`display: none`** when not on home.
- Tab return should **not** remount videos or replay mount-only entrance animations from unmount/remount.
- Parent `Page` re-renders can still pass new props and re-render `HomeStorefront` (memo) — out of scope for 17A.

### Scroll restore

- On transition **home → other**: `homeScrollSavedRef` stores `scrollTop` and `singlesScrollLeft`.
- On transition **other → home**: restores both after layout (`requestAnimationFrame`).
- Other tabs may still use the same `mainScrollRef` while away from home; restore reapplies saved home position only when returning.

### Trace (`NEXT_PUBLIC_PLAYBACK_TRACE=1` or development)

| Event | When |
|-------|------|
| `HOME_STOREFRONT_MOUNT` | `Page` mount (mount count in payload; expect **1** per session if persistence works) |
| `HOME_STOREFRONT_UNMOUNT` | `Page` unmount only |
| `HOME_TAB_HIDDEN` | Leaving home tab (includes saved scroll positions) |
| `HOME_TAB_VISIBLE` | Entering home tab |
| `HOME_SCROLL_RESTORED` | After restore apply |

---

## Manual verification checklist

1. **Build:** `npm run build` succeeds.
2. **Tab return:** Scroll home past hero/singles → Music → Home → scroll position and singles row horizontal position restored; no full “page refresh” flash from remount.
3. **No console error on tab switch:** Confirm no `setHomeScrollSection is not defined`.
4. **Mobile nav (optional):** On home, scroll to vault/cards/shows sections; bottom nav highlight updates without leaving home.
5. **Trace (optional):** `NEXT_PUBLIC_PLAYBACK_TRACE=1 npm run dev` — tab away/back emits `HOME_TAB_HIDDEN`, `HOME_TAB_VISIBLE`, `HOME_SCROLL_RESTORED`; mount count stays 1 across tab cycles.

---

## Out of scope (unchanged)

- `AudioContext`, playback recovery, hero redesign, catalog fetch logic, auth flows
- `LiveCountdownProvider` placement, playback chrome split, full render island refactor
- Stable callback props to `HomeStorefront` (P1)
