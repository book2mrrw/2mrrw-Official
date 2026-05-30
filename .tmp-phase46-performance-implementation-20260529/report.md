# Phase 4.6 — Critical Performance Implementation Report

**Date:** 2026-05-29  
**Platform:** 2MRRW artist-platform  
**Build:** `npm run build` — Next.js 16.2.4 (Turbopack), exit 0, ~9.4s compile  
**Basis:** `.tmp-phase45-performance-audit-20260529/`, `.tmp-phase45-bottleneck-analysis-20260529/`, `.tmp-playback-latency-instrumentation-20260529/`

---

## Executive summary

Phase 4.6 implements all scoped CRITICAL (Group A) and HIGH (Groups B/C) optimizations from the Phase 4.5 audits without touching playback architecture, entitlements, audiovisual autoplay rules, or cinematic UI structure.

The highest-impact change decouples `currentTime` from the AudioContext provider value, eliminating ~60 React context commits/sec during playback across the ~2,778-line storefront page. Scroll-linked hero parallax now updates DOM refs directly instead of `setState` on every scroll event. Initial route JS is split via seven new lazy chunks for modals, admin, vault, and checkout surfaces.

**Build validation:** PASS  
**Net diff:** 11 files, +428 / −174 lines  
**Bundle:** 35 → 42 client chunks; largest shared slice 337 KB → 237 KB (−30% uncompressed on former monolith segment)

---

## Group A — CRITICAL

### A1 — Playback context isolation

| Field | Detail |
|-------|--------|
| **Issue** | RAF `patchState({ currentTime })` ~60/s re-rendered all `useAudioPlayer` consumers |
| **Fix** | `syncProgressTime()` updates `stateRef` + `useSyncExternalStore` subscribers; `currentTime` removed from provider value spread |
| **Files** | `src/context/AudioContext.js`, `src/media/useMediaEngine.js`, `src/lib/player/useImmersivePlayback.js`, `src/components/preview/GlyphLyricsPanel.js`, `src/components/system/AudioPhase10Bridge.js`, `src/system/recovery/usePlaybackRecovery.js` |
| **Before** | Full context value recreated every animation frame while playing |
| **After** | Command context stable during playback; only `usePlaybackProgress()` / media-engine subscribers re-render on progress |
| **Expected gain** | 50–90% fewer React commits during 10s playback (audit target: Page commits <5 vs ~600) |
| **Risk** | Medium — mitigated by scrubber/recovery using subscription or `getCurrentTime()` |
| **Rollback** | Revert AudioContext progress split; restore RAF `patchState` |

### A2 — Render storm elimination (page.js)

| Field | Detail |
|-------|--------|
| **Issue** | Page subscribed to `currentTime`/`duration` for inline mini-player bars |
| **Fix** | Memoized `StorefrontMiniPlayerBar` uses `usePlaybackProgress()`; page no longer destructures progress from `useAudioPlayer()` |
| **Files** | `src/app/page.js` |
| **Before** | Entire Page reconciled on every progress tick |
| **After** | Page stable during playback; isolated mini-player bar re-renders only |
| **Expected gain** | Compounds A1 — eliminates largest subscriber from progress churn |
| **Risk** | Low |
| **Rollback** | Inline mini-player + restore `currentTime` from context |

### A3 — Scroll state optimization

| Field | Detail |
|-------|--------|
| **Issue** | `setHeroScrollY` on every scroll re-rendered full Page |
| **Fix** | `applyHeroParallax()` writes height/opacity/filter/transform via refs (`heroContainerRef`, `heroVideoRef`, `heroTextRef`, `heroSocialsRef`) |
| **Files** | `src/app/page.js` L657–662 area, hero L1783+ |
| **Before** | React setState per scroll event |
| **After** | Passive scroll listener → direct DOM/CSS updates, zero React commits on fling |
| **Expected gain** | Scroll FPS +10–20 on mid mobile (audit estimate) |
| **Risk** | Low — visual behavior preserved |
| **Rollback** | Restore `heroScrollY` state + inline styles |

---

## Group B — HIGH

### B1 — Homepage code splitting

| Field | Detail |
|-------|--------|
| **Fix** | `dynamic(..., { ssr: false })` for ImmersivePreviewModal, AlbumModal, GiftBottomSheet, VaultUnlockedRoom, CheckoutForm, AlbumTracklistSheet, CollectorCardAdminPanel |
| **Files** | `src/app/page.js` |
| **Before** | 35 client chunks; 337 KB framer/stripe-heavy slice in initial graph |
| **After** | 42 client chunks (+7 lazy); largest slice 237 KB |
| **Expected gain** | ~100 KB less initial parse/compile on `/` cold load |
| **Risk** | Low — DonateModal pattern already proven |
| **Rollback** | Restore static imports |

### B2 — Admin isolation

| Field | Detail |
|-------|--------|
| **Fix** | `CollectorCardAdminPanel` dynamic import; loads only when admin renders account tab |
| **Expected gain** | −5–30 KB gzip for non-admin fans (audit estimate) |
| **Risk** | Very low |

### B3 — Deferred tab API fetches

| Field | Detail |
|-------|--------|
| **Fix** | exclusive-drops gated on `activeTab === "vault" \|\| "innercircle"`; printful gated on `activeTab === "shop"`; `printfulLoading` initial false |
| **Files** | `src/app/page.js` L864–901 area |
| **Before** | +2 fetch requests on every home load |
| **After** | 0 printful/exclusive-drops requests until tab intent |
| **Expected gain** | −2 network requests + JSON parse on cold home load |
| **Risk** | Low — brief loading when shop/vault first opened |

---

## Group C — HIGH/MEDIUM

### C1 — Hero MP4 preload

| Field | Detail |
|-------|--------|
| **Fix** | `preload="auto"` → `preload="metadata"` on hero `<video>` |
| **Expected gain** | LCP −200–800 ms (audit estimate); less bandwidth contention |
| **Risk** | Low — brief poster before motion |

### C2 — Concurrent video budget

| Field | Detail |
|-------|--------|
| **Fix** | Extended `syncSinglesCarouselVideos`: max 2 in-view carousel decoders; pause hero on mobile when carousel videos in view |
| **Files** | `src/app/page.js` |
| **Expected gain** | Fewer Safari decoder stalls / tab kills |
| **Risk** | Low — hero resumes when carousel leaves view |

### C3 — GPU pressure (mobile ambient blur)

| Field | Detail |
|-------|--------|
| **Fix** | `AmbientPlaybackBackground` video filter `blur(120px)` → `blur(72px)` when `isMobile` prop true |
| **Files** | `src/components/home/AmbientPlaybackBackground.js`, `src/app/page.js` |
| **Expected gain** | GPU compositing −30–50% during playback (audit estimate) |
| **Risk** | Low–medium — subtle visual softening on mobile only |
| **Rollback** | Restore `blur(120px)` for all viewports |

---

## Bundle snapshot

| Metric | Before (4.5 audit baseline) | After (4.6 build) | Δ |
|--------|------------------------------|-------------------|---|
| Client chunks | 35 | 42 | +7 lazy |
| Total uncompressed | 2.8 MB | 2.8 MB | 0 (split, not removed) |
| Largest chunk | 337,339 B | 237,262 B | **−100 KB (−30%)** |
| Build compile | ~9.9s | ~9.4s | −0.5s |

---

## Protected systems — unchanged

- Playback command queue, resolver, signed URL flow
- Entitlements / account state pipeline
- Audiovisual section viewport autoplay (audio+video)
- Audio format / transcoding
- Cinematic shell layout and framer-motion atmosphere

---

## Instrumentation carry-over (pre-existing unstaged)

Prior session added dev-only playback timing marks in `performanceMarks.js`, `stream-client.js`, and tap/request marks in `AudioContext.js`. These are observability-only and do not affect production perf.
