# Site Feedback Fixes — 2026-05-26

Source: `~/Downloads/site_feedback_notes.txt` (8 items)

## Summary

| # | Feedback (lines) | Status | Notes |
|---|------------------|--------|-------|
| 1 | Album + Features missing play button (L5–8) | **Fixed** | `ReleaseCardActions` now shown when `itemHasPlayableAudio()` — not only when `showCart` |
| 2 | Singles play produces no audio (L10–12) | **Fixed** | CS catalog merge preserved `preview`/`video` from static fallbacks; subscription gate aligned with `subscriberActive` |
| 3 | Cover-art modal complete redesign (L14–17) | **Deferred** | Guardrails: no cinematic/modal tree redesign. **Partial:** modal cover uses `catalogCoverDisplay` for consistent art |
| 4 | Artwork slow on first load (L19–23) | **Fixed** | High-priority preload on home tab; single carousel `poster` on videos. Lazy/off-view behavior unchanged |
| 5 | “My Music” button redesign (L25–30) | **Fixed** | Label “My Music Collection”, gold glow + note icon via `.collection-portal-link` |
| 6 | 2MRRW Radio missing play (L32–35) | **Fixed** | `ReleaseCardPlayButton` on carousel; previews on slides + catalog enrichment; no modal |
| 7 | “More” tab error (L37–40) | **Fixed** | Mobile nav crash when `currentUser.name` missing — safe display name/initial |
| 8 | Swap Vault & Shop nav order (L42–46) | **Fixed** | `MOBILE_NAV_TABS`: Vault middle, Shop before More |

---

## 1. Album / Features play buttons (L5–8)

**Root cause:** `CatalogGrid` and `FeaturesRail` only rendered `ReleaseCardActions` when `access.showCart` was true. Owned/subscriber users have `showCart: false`, so the play control disappeared.

**Changes:**
- `src/lib/music-access.js` — `itemHasPlayableAudio()`
- `src/components/home/CatalogGrid.js` — play row for albums when playable; `showCart` only gates cart
- `src/components/home/FeaturesRail.js` — same pattern as Latest Singles

Album play still opens the tracklist sheet (existing behavior); Features/Radio play inline via `AudioContext`.

---

## 2. Singles audio not playing (L10–12)

**Root cause:** `mergeWithFallback()` in control-system releases preferred API rows without merging `preview` from static singles, yielding empty `track.src` for card play.

**Changes:**
- `src/lib/control-system/releases.js` — `mergeCatalogWithFallback()` for preview/video/cover
- `src/app/page.js` — client catalog fetch merges static single fallbacks by slug
- `src/lib/music-access.js` — subscription check includes `subscriberActive` (matches playback gate)

---

## 3. Modal redesign (L14–17) — **Deferred**

Feedback requests a full cover-art modal overhaul. Project guardrails treat the immersive modal tree and cinematic shell as protected.

**Partial fix:** `ImmersivePreviewModal` resolves cover via `catalogCoverDisplay()` so stage art matches storefront cards (avoids wrong video URL in palette/stage).

**To revisit:** Scoped layout/CSS fixes inside `ImmersiveModalEnvironment` if specific breakpoints are still broken — without replacing the modal architecture.

---

## 4. Artwork load time (L19–23)

**Changes:**
- `src/app/page.js` — on `home` tab, `imagePipeline.preload(..., "high")` for first singles/features/albums/radio covers
- Single carousel videos: `poster={cover}` for immediate still while MP4 loads
- No change to intersection/lazy patterns for off-screen sections

---

## 5. My Music Collection button (L25–30)

**Changes:**
- `src/app/page.js` — button copy + music-note SVG
- `src/app/globals.css` — gold gradient, glow, icon styles on `.collection-portal-link`
- Sidebar/mobile labels already used “My Music Collection” / “Collection” where applicable

---

## 6. 2MRRW Radio play (L32–35)

**Changes:**
- `src/components/home/RadioCarousel.js` — `ReleaseCardPlayButton` (direct play, no modal)
- `src/app/page.js` — preview paths on `radioSlides`; `enrichedRadioSlides` merges catalog audio metadata

---

## 7. More tab broken (L37–40)

**Root cause:** Mobile nav sheet rendered `currentUser.name[0]` when `name` was undefined → `ModalErrorBoundary` “Something went wrong”.

**Changes:**
- `src/app/page.js` — `accountDisplayName` / `accountDisplayInitial` fallbacks (email initial, `"Member"`)

---

## 8. Nav tab order (L42–46)

**Change:** `MOBILE_NAV_TABS` order → Home, Music, Collection, **Vault**, Cards, **Shop**, More.

---

## Verification

- `npm run build` — pass

## Changed files (manifest)

```
src/lib/control-system/releases.js
src/lib/music-access.js
src/components/home/CatalogGrid.js
src/components/home/FeaturesRail.js
src/components/home/RadioCarousel.js
src/components/preview/ImmersivePreviewModal.js
src/app/page.js
src/app/globals.css
docs/reports/site-feedback-fixes-20260526.md
```
