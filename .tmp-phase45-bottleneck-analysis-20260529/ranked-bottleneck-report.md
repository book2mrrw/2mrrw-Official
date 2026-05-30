# Ranked Bottleneck Report — Phase 4.5 Extension

**Platform:** 2MRRW artist-platform  
**Audit date:** 2026-05-29  
**Mode:** Read-only — zero source modifications  
**Build:** `npm run build` — Next.js 16.2.4 (Turbopack), exit 0, compiled ~9.9s  
**Prior audit:** `.tmp-phase45-performance-audit-20260529/` (21 files)

---

## Ranking methodology

Each bottleneck scored 1–5 on six axes (higher = worse for risk axes, higher = better for gain/confidence):

| Axis | Weight in rank |
|------|----------------|
| User Impact | 25% |
| Frequency (how often users hit it) | 20% |
| Severity | 20% |
| Estimated Performance Gain | 15% |
| Regression Risk (inverted — lower risk ranks higher) | 10% |
| Confidence Level | 10% |

**Composite rank** = weighted sum. Ties broken by User Impact, then Confidence.

**Classification:**
- **CRITICAL** — Dominates perceived performance on primary journeys (home, play, scroll); strong code evidence; fix should be first in implementation phase.
- **HIGH** — Material impact; strong evidence; implement with CRITICAL when evidence is strong.
- **MEDIUM** — Real but secondary, narrower surface, or needs live measurement to size.
- **LOW** — Instrumentation, dead code, or marginal gains.

---

## Implementation priority rules

1. **Implement only CRITICAL + HIGH** items that have **strong static evidence** (file:line, build output, or prior audit cross-check).
2. **Measure before each fix** — React Profiler (playback commits), Lighthouse LCP (hero MP4), Network panel (request count). Baseline from this audit; deltas in validation phase.
3. **One P0 fix per release** when touching `AudioContext.js` or `page.js` (protected shell). Rollback path required per item in prior `prioritized-remediation-plan.md`.
4. **MEDIUM/LOW** — backlog unless live measurement elevates severity (e.g. tap→audible p95 > 1.2s).
5. **Out of scope** — entitlement architecture rewrite, cinematic removal, dependency bumps without approval (per project guardrails).

---

## TOP 10 ranked bottlenecks

### #1 — AudioContext progress RAF drives full-tree re-renders

| Field | Value |
|-------|-------|
| **Bottleneck Name** | Playback progress `setState` at display refresh rate |
| **Root Cause** | `startProgressRaf` calls `patchState({ currentTime })` when delta ≥ 0.001s; `value` useMemo spreads entire `state` with `state` in deps |
| **Systems Affected** | All `useAudioPlayer` consumers (~14 modules), `GlobalAudioPlayerBar`, `page.js`, scroll UX while playing |
| **Evidence Collected** | `src/context/AudioContext.js` L532–548 (RAF tick), L2868–2936 (`useMemo` value includes `...state`), L2938+ cleanup; consumers: `grep useAudioPlayer src/` → 14 files; prior audit `05-react-churn.md`, `11-context-churn-audit.md` |
| **Relevant Metrics** | ~60 React context updates/sec while playing (code-path estimate); **requires live measurement** — Profiler commit count Page during 10s playback (target baseline ~600 commits) |
| **Estimated User Impact** | Jank scrolling home while music plays; scrubber/battery drain; amplified by monolithic `page.js` subscriber |
| **Recommended Fix** | Decouple `currentTime` from provider value — ref + subscriber hook, or split ProgressContext; scrubber reads ref/RAF callback |
| **Expected Improvement** | 50–90% fewer React commits during playback (assumption — validate Profiler); smoother scroll/interaction while playing |
| **Regression Risk** | Medium — scrubber, lyrics sync, MediaSession must stay correct |
| **Confidence Level** | **High** (direct code path) |
| **Classification** | **CRITICAL** |

---

### #2 — Monolithic client `page.js` (~2,777 lines)

| Field | Value |
|-------|-------|
| **Bottleneck Name** | Single client boundary for entire storefront |
| **Root Cause** | `"use client"` at L1; 40+ static imports including framer-motion, Stripe, Vault, modals, admin |
| **Systems Affected** | `/` route hydration, TTI, parse/compile, every tab/modal in one reconciliation tree |
| **Evidence Collected** | `wc -l src/app/page.js` → 2777; L4–69 imports; only `DonateModal` dynamic (L8); `CollectorCardAdminPanel` static L17; build: 35 chunks **2.8 MB** total uncompressed (`du .next/static/chunks`) |
| **Relevant Metrics** | 2.8 MB client chunks (measured build); top chunks 407 KB ×2, 337 KB (framer+stripe), 216 KB (supabase); **requires live measurement** — TTI, main-thread parse time |
| **Estimated User Impact** | Slow first interactive on mobile; large JS download before catalog/play usable |
| **Recommended Fix** | Tab-level `dynamic()` imports; defer admin/modals; keep shell structure |
| **Expected Improvement** | 100–300 KB less initial parse (assumption); faster TTI on 3G |
| **Regression Risk** | Low — pattern exists for DonateModal |
| **Confidence Level** | **High** (line count + chunk sizes) |
| **Classification** | **CRITICAL** |

---

### #3 — Hero MP4 `preload="auto"` + scroll-driven filter/transform

| Field | Value |
|-------|-------|
| **Bottleneck Name** | Aggressive hero video load competing with LCP/JS |
| **Root Cause** | Hero `<video preload="auto">` + inline styles tied to `heroScrollY` state |
| **Systems Affected** | Home LCP, mobile Safari memory, network bandwidth on cold load |
| **Evidence Collected** | `src/app/page.js` L1783 (`preload="auto"`, `catalogMotionVideoUrl("videos/A2B.mp4")`), L1787–1789 (`filter` blur, `transform` scale from `heroScrollY`); scroll handler L657–662 `setHeroScrollY`; prior `08-mp4-loop-audit.md` |
| **Relevant Metrics** | **requires live measurement** — LCP element, hero MP4 Content-Length/TTFB (CDN HEAD); Lighthouse LCP delta if preload=metadata |
| **Estimated User Impact** | Delayed first paint; hero stutter on scroll; Safari tab kills under memory pressure |
| **Recommended Fix** | `preload="metadata"` or poster-first; move parallax to CSS variables via ref (pairs with #4) |
| **Expected Improvement** | LCP −200–800 ms (assumption from prior audit); lower decode contention |
| **Regression Risk** | Low — brief poster before motion |
| **Confidence Level** | **High** (attributes in source) |
| **Classification** | **CRITICAL** |

---

### #4 — Main scroll → React `setHeroScrollY` on every scroll event

| Field | Value |
|-------|-------|
| **Bottleneck Name** | Scroll-linked React state for hero parallax |
| **Root Cause** | `mainScrollRef` scroll listener calls `setHeroScrollY(el.scrollTop)` without throttling |
| **Systems Affected** | Entire `page.js` tree re-renders on fling scroll; compounds #1 during playback |
| **Evidence Collected** | `src/app/page.js` L657–662, L1787–1789 hero styles consume `heroScrollY`; passive listener (good) but still schedules React updates |
| **Relevant Metrics** | **requires live measurement** — Scripting ms during 3s fling; FPS on iOS Safari 375px |
| **Estimated User Impact** | Scroll jank on home; worst when audio playing (#1) |
| **Recommended Fix** | Update CSS custom properties on scroll via ref; no `setState` per frame |
| **Expected Improvement** | Scroll FPS +10–20 on mid mobile (assumption) |
| **Regression Risk** | Low |
| **Confidence Level** | **High** |
| **Classification** | **HIGH** |

---

### #5 — AmbientPlaybackBackground `blur(120px)` on full-viewport video

| Field | Value |
|-------|-------|
| **Bottleneck Name** | Extreme GPU filter during playback |
| **Root Cause** | `filter: blur(120px) saturate(1.2) brightness(0.15)` on fixed full-screen video layers |
| **Systems Affected** | GPU compositing while playing; mobile Safari thermal; scroll under ambient |
| **Evidence Collected** | `src/components/home/AmbientPlaybackBackground.js` L22, L41–49 (autoPlay video), L33 (`blur(72px)` on image layer); up to 2 video layers when CS mode |
| **Relevant Metrics** | **requires live measurement** — GPU timeline, FPS with ambient on vs off |
| **Estimated User Impact** | Device heat, battery drain, frame drops when music plays |
| **Recommended Fix** | Reduce blur radius, static pre-blurred asset, or image-only ambient on mobile |
| **Expected Improvement** | GPU compositing −30–50% (assumption); needs aesthetic approval |
| **Regression Risk** | Low–medium (visual) |
| **Confidence Level** | **High** (CSS in source) |
| **Classification** | **HIGH** |

---

### #6 — Concurrent MP4 decoders (hero + carousel + ambient)

| Field | Value |
|-------|-------|
| **Bottleneck Name** | Multiple simultaneous video decodes on Home |
| **Root Cause** | No global concurrent-video budget; hero always plays; carousel plays in-viewport; ambient when track has video cover |
| **Systems Affected** | Mobile Safari decoder limits (2–3 HD typical); memory |
| **Evidence Collected** | Hero L1783; `LatestSinglesStyleRow.js` L103–110 `preload="metadata"`; `syncSinglesCarouselVideos` L631–641; ambient videos L41–70; model in `08-mp4-loop-audit.md` (2–5 decoders) |
| **Relevant Metrics** | **requires live measurement** — DOM `<video>` count, Safari memory graph |
| **Estimated User Impact** | Dropped frames, paused carousel, background tab kills |
| **Recommended Fix** | Global max-active decoder policy; defer carousel until hero metadata loaded |
| **Expected Improvement** | Fewer decode stalls; stabler carousel (assumption) |
| **Regression Risk** | Low |
| **Confidence Level** | **Medium–High** (architecture clear; device limits vary) |
| **Classification** | **HIGH** |

---

### #7 — Eager tab/API fetches on mount (non–home-tab data)

| Field | Value |
|-------|-------|
| **Bottleneck Name** | Printful + exclusive-drops fetch regardless of active tab |
| **Root Cause** | `useEffect` with `[]` deps for exclusive-drops L864–880; printful L899+ always runs |
| **Systems Affected** | Cold-load network, main-thread JSON parse, competes with catalog + hero MP4 |
| **Evidence Collected** | `src/app/page.js` L864–880 (`/api/catalog/exclusive-drops`), L899–901 (`/api/printful/products`); vault correctly gated L882–897 (`activeTab !== "innercircle"`); catalog L698–706 always runs |
| **Relevant Metrics** | +2–4 fetch requests on load (static count); **requires live measurement** — waterfall timing |
| **Estimated User Impact** | Slower catalog/singles visible; higher data on cellular |
| **Recommended Fix** | Gate printful/exclusive-drops on `activeTab`; defer until shop/exclusives opened |
| **Expected Improvement** | −2–4 requests initial load (count-based); faster catalog path (assumption) |
| **Regression Risk** | Low — brief loading on shop tab |
| **Confidence Level** | **High** |
| **Classification** | **HIGH** |

---

### #8 — Root layout provider stack on every route

| Field | Value |
|-------|-------|
| **Bottleneck Name** | Global Auth + Audio + Stripe + PostHog hydration tax |
| **Root Cause** | All client providers wrap `{children}` on every page |
| **Systems Affected** | All routes including `/login`, `/subscribe`; AudioContext ~2,973 lines always initialized |
| **Evidence Collected** | `src/app/layout.js` L38–54 provider nesting; `wc -l AudioContext.js` → 2973; chunks supabase 216 KB, posthog 189 KB, framer 135–337 KB |
| **Relevant Metrics** | 2.8 MB total chunks (measured); **requires live measurement** — per-route first load |
| **Estimated User Impact** | Heavier auth/checkout pages than necessary; baseline memory |
| **Recommended Fix** | Route-group layouts: lean shell for auth routes; keep audio on music routes (larger change) |
| **Expected Improvement** | Moderate on satellite routes (assumption) |
| **Regression Risk** | Medium — provider boundary changes |
| **Confidence Level** | **Medium** (structure clear; per-route savings need measurement) |
| **Classification** | **MEDIUM** |

---

### #9 — Stream JSON path serial HEAD probe

| Field | Value |
|-------|-------|
| **Bottleneck Name** | Extra RTT after JSON stream response |
| **Root Cause** | `fetchLibraryStream` awaits `assertSignedAudioUrl` HEAD after JSON body |
| **Systems Affected** | Visibility refresh, non-redirect stream paths (not primary entitled tap) |
| **Evidence Collected** | `src/lib/playback/stream-client.js` L25–47, L202; redirect fast-path documented `03-audio-start-latency.md`; `AudioContext` visibility refresh L2620+ |
| **Relevant Metrics** | +50–200 ms per JSON path (assumption); **requires live measurement** — HAR on tab refocus refresh |
| **Estimated User Impact** | Stall/resume delay after backgrounding; not first-tap play for entitled redirect |
| **Recommended Fix** | Skip HEAD when proxy URL same-origin; trust server content-type |
| **Expected Improvement** | −1 RTT on refresh path |
| **Regression Risk** | Low |
| **Confidence Level** | **High** for path existence; **Medium** for user-visible frequency |
| **Classification** | **MEDIUM** |

---

### #10 — Duplicate library refresh (`refreshAccountState` + `refreshLibrary`)

| Field | Value |
|-------|-------|
| **Bottleneck Name** | Paired API calls on library mutations |
| **Root Cause** | Callbacks invoke both; `/api/account/state` includes library; `/api/library` separate |
| **Systems Affected** | Network on add-to-library, purchase confirm flows |
| **Evidence Collected** | `src/context/AuthContext.js` L118 (`/api/library`), L140 (`/api/account/state`); `page.js` L1841–1842, L1303 `Promise.all([refreshAccountState(), refreshLibrary()])` |
| **Relevant Metrics** | **requires live measurement** — duplicate library payload bytes |
| **Estimated User Impact** | Minor latency on library actions; not startup |
| **Recommended Fix** | Single refresh entry point; account state subsumes library |
| **Expected Improvement** | −1 request per library action |
| **Regression Risk** | Low |
| **Confidence Level** | **High** (call sites) |
| **Classification** | **MEDIUM** |

---

## Summary counts

| Classification | Count in TOP 10 |
|----------------|-----------------|
| **CRITICAL** | 3 (#1, #2, #3) |
| **HIGH** | 4 (#4, #5, #6, #7) |
| **MEDIUM** | 3 (#8, #9, #10) |
| **LOW** | 0 in top 10 |

**Additional HIGH-adjacent (not in top 10):** Eager cover preload 18 items on home tab (`page.js` L822–834); `loadStripe` module scope L69; dev-only perf marks (`performanceMarks.js` L27–32); admin panel in fan bundle L17.

---

## Build evidence snapshot (2026-05-29)

```
Compiled successfully in 9.9s
Static: / (○), /subscribe, /login, ...
Client chunks: 35 files, 2.8M total (du)
Largest: 416613, 416613, 337339, 227537, 215965 bytes
page.js: 2777 lines | AudioContext.js: 2973 lines | AuthContext.js: 448 lines
```
