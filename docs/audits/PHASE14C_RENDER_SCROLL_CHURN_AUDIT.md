# Phase 14C — Render & Scroll Churn Audit

**Date:** 2026-06-01  
**Scope:** `src/app/page.js`, `src/components/home/LatestSinglesStyleRow.js`, scroll/IO/countdown surfaces  
**Sources:** Phase 14 plan (`docs/audits/PHASE14_IMPLEMENTATION_PLAN.md`), playback forensic reports (`.tmp-playback-interruption-forensic-20260531/`), Phase 45/46 performance audits, ranked churn (`.tmp-playback-stability-churn-audit-20260531/ranked-root-causes.md`)

---

## ROOT_CAUSE_MAP (severity for Phase 14C)

| ID | Finding | Severity | Confidence | Primary files |
|----|---------|----------|------------|---------------|
| RC-14C-1 | `opacity:0` + `fadeInUp` on every card render (Latest Singles row) | **HIGH** | High | `LatestSinglesStyleRow.js` L84–85 |
| RC-14C-2 | `liveCountdown` 1 Hz `setInterval` on `Page()` | **HIGH** | High | `page.js` L760–761, L1186–1200 |
| RC-14C-3 | `applyHeroParallax` mutates hero **height** + video **opacity** per scroll | **HIGH** | High | `page.js` L842–867, L869–886 |
| RC-14C-4 | `syncSinglesCarouselVideos` play/pause on scroll (carousel only) | **MEDIUM** | High | `page.js` L800–818, L1092–1117 |
| RC-14C-5 | `homeScrollSection` IO → `setState` on mobile home scroll | Medium | High | `page.js` L777, L910–947 |
| RC-14C-6 | Catalog IO / `logUiChurn` intersection traces | Low (diag) | High | `page.js` L424–455, L931–936 |
| RC-14C-7 | `catalogLoading` skeletons adjacent to singles row | Low | High | `page.js` L2106–2111, L781 |
| RC-14C-8 | `window` vs `mainScrollRef` dual scroll models | Medium | High | `page.js` L790, L2030+; `useScrollRecovery` (window) |
| RC-14C-9 | Sections/components returning `null` | Low–Medium | High | See §6 |

**Playback/auth (Phase 14 / 14b — verify only, patch gaps):** commits `390c80d` (element-authoritative `isPlaying`), `443c6e5` (`sessionHydrated` + `authStatus` gate, `playbackNetworkState`). No re-architecture in 14C.

---

## 1. Scroll handlers with setState in page.js

| Handler | setState? | Role |
|---------|-----------|------|
| `mainScrollRef` scroll listener | No (DOM via `applyHeroParallax`) | Hero parallax DOM writes; trace `logUiChurn("scroll")` when enabled |
| `homeScrollSection` IO | **Yes** — `setHomeScrollSection` | Mobile nav highlight for vault/cards/shows while on home tab |
| `syncSinglesCarouselVideos` | No | Pauses/plays `video[data-single-carousel]`; mobile hero video coordination |
| `logUiChurn` | No | Diagnostics only (`scroll`, `section-change`, `catalog-rerender`, `intersection`) |

**Risk:** RC-14C-3 (parallax height/opacity) causes layout/paint churn coincident with scroll; RC-14C-5 can re-render full `Page` when IO fires frequently.

---

## 2. `opacity:0` + fadeIn patterns

| Location | Pattern | Re-render impact |
|----------|---------|------------------|
| `LatestSinglesStyleRow.js` L84–85 | Inline `opacity: 0` + `animation: fadeInUp … forwards` on **every** card | **HIGH** — parent re-render resets inline opacity → visible flash |
| `FeaturesRail.js` L17 | Same pattern | Medium (smaller row) |
| `page.js` L2613 | Inner Circle posts | Medium (tab-scoped) |
| `page.js` L2920+ | `@keyframes fadeInUp` in page `<style>` | Shared animation definition |
| Framer modal overlays | `opacity: 0` initial | Expected; modal-scoped |

**Phase 14C fix target:** `LatestSinglesStyleRow` (RC-14C-1).

---

## 3. `setInterval` liveCountdown on Page

- **State:** `liveCountdown`, `liveIsLive` (`page.js` L760–761).
- **Effect:** `setInterval(tick, 1000)` (`page.js` L1186–1200) against `nextLiveDateTime` (L266).
- **Consumers:** `LivePanel`, mobile home strip, `#home-live` block, `activeTab==="live"` panel (L2124–2151, L2296–2303, L2435–2449).
- **Impact:** Full `Page()` React commit ~1 Hz even when user is scrolling catalog or playing audio (RC-14C-2).

---

## 4. IO effects & catalog loading skeletons

| Effect | Trigger | setState |
|--------|---------|----------|
| Audio Visuals IO | `AudioVisualsSection` mount | No on Page; callbacks `enterAudioVisualViewport` / `exit` |
| Home section IO | `home-vault`, `home-cards`, `home-shows` | `setHomeScrollSection` |
| Catalog fetch | `catalogPage`, tab | `setBrowseSingles`, `setCatalogLoading`, `setCatalogHasMore` |
| Singles skeletons | `catalogLoading` | Renders `TrackCardSkeleton` ×2 under Latest Singles row |

**Note:** IO does not hide sections; it only drives nav highlight (RC-14C-5).

---

## 5. `window` vs `mainScrollRef`

| Surface | Scroll container |
|---------|------------------|
| Primary catalog column | `mainScrollRef` — `data-main-scroll`, `overflowY: auto` |
| Hero parallax / trace scroll | `mainScrollRef.scrollTop` |
| Singles carousel video sync | Row `scroll` + `window` `resize` |
| `useScrollRecovery` (layout) | **`window.scrollY`** (legacy; Phase 14 plan §3) |
| Cursor / ambient | `window` listeners |

**Risk:** Restoring scroll to `window` while user scrolls `mainScrollRef` feels like “jump” or reload (RC-14C-8). Out of 14C code scope except documenting.

---

## 6. Sections returning `null`

| Location | Condition | Hides UI? |
|----------|-----------|-----------|
| `LatestSinglesStyleRow.js` L36 | `!items?.length` | Row absent (expected) |
| `page.js` L1613 | `!currentUser` | User-specific block |
| `page.js` L1824 | Stock null helper | Inventory badge |
| `catalogLoading` skeletons | Loading only | Additive, not `null` section |
| Tab panels | `activeTab === "…"` conditional render | Unmount inactive tabs (not `null` return from section component) |

No evidence home vault/cards/shows sections return `null` to hide content during scroll.

---

## 7. Playback & auth (verify 390c80d + 443c6e5)

| Check | Status |
|-------|--------|
| No optimistic `isPlaying` before `play()` | Addressed in `390c80d` — verify at `AudioContext.js` `playTrackInternal` / `onPlay` |
| `playbackNetworkState` on load/buffer/error | Addressed in `443c6e5` |
| `AppAuthRoot` gates on `sessionHydrated && authStatus === "unauthenticated"` | `443c6e5` — `AppAuthRoot.js` L25–27 |

14C does not rewrite `AudioContext` architecture.

---

## Phase 14C remediation summary

1. **Disable** `applyHeroParallax` height/opacity mutations (keep passive scroll; carousel sync unchanged).
2. **Isolate** live countdown state outside `Page()` (context or leaf ticker).
3. **Fix** `LatestSinglesStyleRow` — CSS enter class + `animation-fill-mode`, no inline `opacity: 0`.
4. **Throttle / dedupe** `homeScrollSection` IO updates (nav highlight only).
5. **Keep** `syncSinglesCarouselVideos` for carousel videos only.

---

## Validation checklist

```bash
npm run build
rg 'container\.style\.height' src/app/page.js   # expect 0 or commented disabled
rg 'opacity:\s*0' src/components/home/LatestSinglesStyleRow.js  # expect 0
```

Manual: iOS Safari — scroll home while audio plays; confirm no hero height collapse, no singles card flash, nav highlight still tracks vault/cards/shows.
