# Phase P5 — Storefront-wide persistent media lifecycle

**Date:** 2026-06-03  
**Mode:** Forensic audit + implementation  
**Repository:** `/Users/recharge/artist-platform`

---

## Executive summary

| Field | Value |
|-------|-------|
| **Decoder reset path (one-liner)** | `syncSinglesCarouselVideos` in `page.js` called `video.load()` when `readyState < 2` on re-entry and `video.pause()` off-view — **removed**; P5 uses `ensureStorefrontCarouselMedia` with no `load()` and no scroll-driven pause. |
| **Black artwork path (one-liner)** | Paused carousel `<video>` with incomplete decode after feed-style pause/top-2 cap — **fixed** by persistent muted `autoPlay` loops and play-only ensure on home tab. |
| **Phase 17 introduced feed regression?** | **No** — feed-style sync pre-dated 17A; 17A fixed tab unmount; 20F fixed scroll IO Page churn. |
| **Top-2 decoder cap** | **Removed** — no longer necessary for product contract; memory trade-off accepted (see §5). |

---

## 1. Exact decoder reset path (pre-P5)

| Step | File:line | Action |
|------|-----------|--------|
| 1 | `page.js` (former L402–410) | Off-view carousel cards: `video.pause()` |
| 2 | `page.js` (former L418–428) | In-view sorted by width; only top 2 `play()`; rank 3+ `pause()` |
| 3 | `page.js` (former L419–424) | Before play: `if (video.readyState < 2) video.load()` — **decoder reset without React remount** |
| 4 | `page.js` (former L638–640) | `document.visibilitychange` hidden → pause all `[data-single-carousel]` |

**Post-P5:** Steps 1–3 eliminated for storefront carousel. Step 4 retained (tab background only). `useCoverPalette.js:192` `video.load()` is palette extraction, not storefront cards.

---

## 2. Exact black artwork path (pre-P5)

1. Card scrolls off-view → `pause()` while `readyState < 2` (metadata-only or mid-decode).
2. Card re-enters → `play()` after optional `load()` → Safari/iOS shows black until decode completes.
3. Partially visible card not in top-2 → paused while still on screen → black frame visible.
4. Poster/`#0a0a0a` background mitigated symptom but did not fix feed architecture.

**Post-P5:** Cards stay playing once mounted; `autoPlay` + `preload="auto"` + poster; scroll does not pause or `load()`.

---

## 3. All `video.load()` call sites

| File:line | Context | P5 impact |
|-----------|---------|-----------|
| `page.js` (removed) | `syncSinglesCarouselVideos` readyState gate | **Removed** |
| `useCoverPalette.js:192` | Cover color extraction from video | Unchanged (non-storefront) |

No other `video.load()` in `src/` for catalog card artwork.

---

## 4. All visibility-gating logic (storefront)

| # | File:line | Trigger | Pre-P5 action | Post-P5 action |
|---|-----------|---------|---------------|----------------|
| 1 | `page.js` | Singles/main scroll, resize | pause off-view; play top 2; `load()` | **Play-only ensure** + mobile hero sync; **no pause/load** |
| 2 | `page.js` | `document.visibilitychange` hidden | pause all carousel videos | **Unchanged** (OS tab background) |
| 3 | `page.js:492–517` | Home subsection IO | Nav highlight only (20F) | Unchanged |
| 4 | `usePlaybackCardPrewarm.js` | Card IO 15% | Descriptor warm only | Unchanged |
| 5 | `AudioVisualsSection.js` | Section IO | YouTube play/pause | Unchanged (intentional playback surface) |
| 6 | `page.js:1459–1462` | `activeTab !== "home"` | `display:none` persist (17A) | Unchanged |
| 7 | `storefront-persistent-media.js` | `isStorefrontCarouselCardInView` | N/A | **Hero coordination only** — not used to pause carousel |

---

## 5. Storefront-wide lifecycle findings (per section)

| Section | Media | Pre-P5 | Post-P5 |
|---------|-------|--------|---------|
| **Latest Singles** | `<video data-single-carousel>` | Feed decoder pool (2 cap, pause/load) | Persistent muted loop, `autoPlay`, P5 contract module |
| **Featured** | `CoverArt` img | Persistent; no video sync | Unchanged — verified `FeaturesRail.js` |
| **Albums** | `CoverArt` img | Persistent; prewarm IO only | Unchanged — verified `CatalogGrid.js` |
| **Mixtapes & EPs** | `CoverArt` via `LatestSinglesStyleRow` `cardMedia="cover"` | No `data-single-carousel` | Unchanged |
| **Hero** | `<video>` A2B.mp4 | Mobile pause when singles in view | **Preserved** via `syncMobileHeroWithStorefrontCarousel` |
| **CoverArt video type** | `autoPlay loop muted` always | No offscreen pause | Unchanged — aligns with P5 contract |

---

## 6. Phase 17 contribution

| Question | Answer |
|----------|--------|
| Did Phase 17 introduce feed-style video lifecycle? | **No** — `syncSinglesCarouselVideos` existed before 17A (Phase 17 audit rank #5). |
| Did 17A help? | **Yes** — persist mount (`display:none`) stops tab-return remount tear-down. |
| Did 17C IO regression hurt media? | **Yes, transient** — full Page reconcile on scroll; **fixed in 20F** external scroll store. |
| Did P5 depend on 17A/20F? | **Yes** — implementation keeps 17A persist + 20F keys; only replaces DOM feed sync. |

---

## 7. `syncSinglesCarouselVideos`, hero coordination, readyState, top-2 limit

| Topic | Finding |
|-------|---------|
| **syncSinglesCarouselVideos** | **Replaced** by `ensureStorefrontCarouselMedia` + `src/lib/storefront/storefront-persistent-media.js`. Scroll handlers debounce layout changes for hero + play-ensure only. |
| **Hero coordination** | Mobile: pause hero when any carousel card ≥35% width + vertical in-view; resume when none. Does not pause carousel decoders. |
| **readyState** | No longer consulted for `load()` on storefront cards. Browser manages decode; `preload="auto"` + `autoPlay` on card mount. |
| **Top-2 limit** | **Removed** — was a GPU budget workaround incompatible with persistent artwork. Expected memory/GPU increase bounded by singles count (~8 preloaded). |

---

## 8. Implementation summary

| File | Change |
|------|--------|
| `src/lib/storefront/storefront-persistent-media.js` | **New** — P5 contract: play-ensure, document-hidden pause, hero sync helper |
| `src/app/page.js` | Replace `syncSinglesCarouselVideos` with `ensureStorefrontCarouselMedia`; import P5 helpers |
| `src/components/home/LatestSinglesStyleRow.js` | `autoPlay` on carousel `<video>` |
| `src/components/home/HeroSection.js` | Comment update for P5 hero coordination |

**Preserved:** 17A persist mount, 20F scroll store, 20G/20H media URLs, playback P1–P3, P4 metadata fixes, `PlaybackPrewarmCardShell`, Audio Visuals IO.

---

## Expected memory impact

- **Before:** Max ~2 active carousel decoders + N paused elements retaining buffers (implementation-dependent).
- **After:** All mounted Latest Singles MP4 loops may decode concurrently (typically ≤10 cards in row; ~8 preloaded via `imagePipeline`). **Higher peak GPU/RAM** on iOS when many videos mounted; mitigated by 17A not unmounting on tab switch (no repeated decode churn).
- Static Featured/Albums/Mixtapes unchanged (images).

---

## Expected iOS Safari impact

- **Positive:** No scroll-driven `pause()` / `load()` → fewer black frames and decode restarts on horizontal/vertical scroll.
- **Risk:** Multiple simultaneous muted loops may pressure GPU; monitor on device with full singles row. Hero still pauses on mobile when singles visible to reduce competing decode with ambient hero MP4.
- **Tab background:** Carousel still pauses on `document.hidden` (battery/OS convention).

---

## Validation

```text
npm run build                      → required pass
npm run check:frontend-guardrails  → required pass
```

Manual: home → Latest Singles scroll horizontally and vertically → no black flicker; off-screen cards keep looping when returning; hero mobile behavior unchanged; Features/Albums/Mixtapes unchanged.

---

## Commit

`Phase P5: storefront-wide persistent media lifecycle for catalog cards`

---

## References

- `docs/audits/PHASE_P4_CORRECTION_STOREFRONT_MEDIA_LIFECYCLE_AUDIT.md`
- `docs/audits/PHASE_P4_MEDIA_CARD_VIDEO_AND_METADATA.md`
- `docs/audits/PHASE17_RENDER_ISLAND_AUDIT.md`
- `docs/audits/PHASE20F_GLOBAL_MEDIA_RENDER_STABILITY_FIX.md`
