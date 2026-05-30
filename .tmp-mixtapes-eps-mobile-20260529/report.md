# Mixtapes & EPs — Mobile Parity Report (2026-05-29)

Viewport: **375×812** (CDP `Emulation.setDeviceMetricsOverride`, mobile UA). Dev server: `http://127.0.0.1:3456`.

## Summary

Home **Mixtapes & EPs** row now uses the same `singles-row` class and mobile CSS as **Latest Singles**, with matching card metrics and horizontal scroll containment. **My Music** owned Mixtapes/EPs sections stack vertically on mobile without page-level horizontal overflow. **Album tracklist sheet** received mobile-safe height, scrolling, and compact row chrome.

`npm run build` — **pass**.

---

## 1. Home — Mixtapes & EPs row (375px)

| Check | Latest Singles | Mixtapes & EPs | Result |
|-------|----------------|----------------|--------|
| Row class | `singles-row` | `singles-row` (was `mixtapes-eps-row`) | **Match** |
| Card width (rendered) | 162px | 162px | **Match** (160px + 1px border ×2) |
| Card height | 272px | 272px | **Match** |
| Row gap | 12px | 12px | **Match** |
| scroll-snap | `x mandatory` | `x mandatory` | **Match** |
| overflow-x | `auto` (row only) | `auto` (row only) | **Match** |
| Parent `minWidth: 0` wrapper | Yes | Yes (added) | **Match** |

**Fix applied:** Removed custom `mixtapes-eps-row` class; wrapped row in `width:100%; minWidth:0` container (same pattern as Latest Singles). Added `.mixtapes-eps-row` to mobile CSS selectors as backward-compatible alias.

---

## 2. My Music — Owned Mixtapes section (375px)

| Check | Result |
|-------|--------|
| Section visible (guest) | Empty state: "No owned releases yet." |
| Vertical stack on mobile | Rows use `flexDirection: column` when `isMobile` |
| Section width vs viewport | `width:100%`, `overflow:hidden`, no `scrollWidth` overflow |
| Action buttons | `minHeight: 44px`, full-width flex row on mobile |
| Page horizontal scroll | **None** (`pageScrollX: false`) |

**Fix applied:** `OwnedReleaseList` accepts `isMobile`; mobile column layout, ellipsis titles, 44px touch targets, `onOpenAlbumTracklist` for Tracklist button.

---

## 3. My Music — Owned EPs section (375px)

Same treatment as Owned Mixtapes — shared `OwnedReleaseList` component. Empty-state and layout checks identical; no horizontal overflow detected at 375px.

---

## 4. Tracklist modal — AlbumTracklistSheet (375px)

| Check | Result |
|-------|--------|
| `isMobile` prop wired from `page.js` | Yes |
| Sheet max height | `min(78dvh, calc(100dvh - safe-area-inset-top - 48px))` |
| Track list scroll | `overflowY: auto`, `overflowX: hidden`, `-webkit-overflow-scrolling: touch` |
| Row overflow on narrow width | Duration and ±15s seek hidden on mobile; 40×40 play control |
| Safe areas | Left/right inset padding on overlay |

**Browser note:** Albums `CatalogGrid` is empty in dev (0 `.albums-row` children), so tracklist sheet was not opened interactively in this session. Layout changes follow the same bottom-sheet pattern used elsewhere on mobile. Recommend one manual open via **Play** on an album card (grid) or **Tracklist** in My Music when logged in with owned releases.

---

## 5. Horizontal page scroll check (375px)

| Surface | `documentElement.scrollWidth > clientWidth` |
|---------|-------------------------------------------|
| Home (Mixtapes & EPs in view) | **false** |
| My Music Collection tab | **false** |
| After mixtape card tap (album modal) | **false** |

---

## Files changed

| File | What was fixed |
|------|----------------|
| `src/app/page.js` | Mixtapes row uses default `singles-row`; `minWidth:0` wrapper; mobile CSS includes mixtapes alias; `onOpenAlbumTracklist` → My Music; `isMobile` on `AlbumTracklistSheet` |
| `src/components/music/MyMusicTab.js` | Root `overflowX:hidden`; `OwnedReleaseList` mobile stack + tracklist callback; carousel `overscrollBehaviorX` |
| `src/components/music/AlbumTracklistSheet.js` | Mobile viewport height, scroll containment, compact track rows, larger play tap target |

**Unchanged (already correct):** `src/components/home/LatestSinglesStyleRow.js` — shared 160/200px cards, scroll snap, `ReleaseCardActions`.

---

## Build

```
npm run build — exit 0
```

---

## Deliverable

Zip: `/Users/recharge/Downloads/mixtapes-eps-mobile-20260529.zip`
