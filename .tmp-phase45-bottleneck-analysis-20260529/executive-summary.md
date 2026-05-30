# Executive Summary — Phase 4.5 Bottleneck Analysis

**Date:** 2026-05-29  
**Repo:** artist-platform @ `/Users/recharge/artist-platform`  
**Mode:** Read-only audit extension — **zero source code modified**  
**Inputs:** Prior audit `.tmp-phase45-performance-audit-20260529/`, fresh `npm run build`, deep-read of AudioContext, page.js, layout.js, AmbientPlaybackBackground, LatestSinglesStyleRow, stream routes, AuthContext

---

## Top 3 perceived slowness causes

1. **Monolithic home shell (~2,777-line client `page.js`)** — Large JS parse/hydrate before the storefront feels interactive. *Evidence: line count, 2.8 MB client chunks (build).*
2. **React re-renders during playback** — Audio progress updates context ~60×/sec, re-rendering page + player subscribers. *Evidence: `AudioContext.js` L532–548, L2868–2936.*
3. **Cold-load network stack** — Catalog API (`no-store`), auth/account state, hero MP4 `preload="auto"`, and eager shop/exclusive fetches run together. *Evidence: `page.js` L703, L868, L901, L1783.*

*Live CWV not measured — label as code-path inference.*

---

## Top 3 startup heat causes

1. **Parallel startup burst** — JS chunks (~2.8 MB) + hero full-buffer MP4 + catalog/auth API + up to 18 cover preloads. *Evidence: build `du`, page mount effects.*
2. **GPU compositing at rest** — Multiple `backdrop-filter` layers on home chrome + hero CSS `filter`/`transform` tied to scroll state. *Evidence: `page.js` L1733, L1787, L2394+.*
3. **framer-motion + Stripe module init** — Animation library and `loadStripe` evaluate with page chunk before user needs checkout. *Evidence: L4–6, L69; 337 KB chunk association from prior audit.*

*Device temperature: **requires live measurement** (Energy Log).*

---

## Top 3 playback delay causes

1. **Server stream resolution chain** (entitled) — Auth, entitlement DB, `resolvePlaybackKey`, sign, proxy on `/api/library/stream`. *Evidence: `route.js` L44–80+; est. 150–600 ms cold from prior `03-audio-start-latency.md` — **assumption**.*
2. **JSON stream path + HEAD probe** (refresh / non-redirect) — Extra serial RTT after JSON. *Evidence: `stream-client.js` L202.*
3. **Client work at play start** — Web Audio init, `preloadCoverImage`, gesture unlock, `waitAudioSrcReady`. *Evidence: `AudioContext.js` L641+, L1412+, L1366+.*

*Tap→audible: redirect path is well-designed; **requires live measurement** for p50/p95.*

---

## Top 3 mobile degradation causes

1. **Concurrent MP4 decoders** — Hero always on + in-viewport carousel + optional ambient video (2–5 decoders). *Evidence: `08-mp4-loop-audit.md` model, source lines cited in ranked report.*
2. **Scroll + playback React churn** — `setHeroScrollY` + audio RAF on same page tree. *Evidence: `page.js` L657–662 + AudioContext RAF.*
3. **Safari memory / iOS resume conservatism** — Large JS heap + video buffers; visibility handler may not auto-resume on iOS. *Evidence: `07-mobile-safari.md`, `AudioContext` L2679+.*

---

## Top 3 highest-value fixes

1. **Decouple `currentTime` from AudioContext provider value** — CRITICAL; largest commit reduction while playing. *Confidence: High.*
2. **Hero MP4 preload policy + scroll parallax without React state** — CRITICAL/HIGH pair; improves LCP and scroll. *Confidence: High.*
3. **Defer non-visible tab fetches (printful, exclusive-drops) + tab-level dynamic imports** — HIGH; lowers startup contention without architectural rewrites. *Confidence: High.*

---

## Estimated improvements

| Area | Estimate | Basis |
|------|----------|-------|
| **Responsiveness while playing** | 50–90% fewer React commits | Assumption — Profiler validation needed |
| **Playback tap→audible (entitled)** | Already optimized via redirect; refresh path −50–200 ms if HEAD removed | Assumption — HAR |
| **Startup / LCP** | LCP −200–800 ms if hero preload relaxed | Assumption — Lighthouse |
| **Memory** | Fewer concurrent decodes / smaller initial parse with code-split | Assumption — Safari inspector |
| **Battery / thermal** | Meaningful reduction if RAF + ambient blur addressed | Assumption — sustained CPU/GPU lower |

**Measured in this pass:** production build success; **2.8 MB** total client chunk bytes (35 files); **2777** / **2973** lines page/AudioContext.

**Not measured:** Core Web Vitals, tap→audible p95, FPS, device temperature — all marked **requires live measurement**.

---

## Classification snapshot

| Level | Count (TOP 10 ranked) |
|-------|-------------------------|
| CRITICAL | 3 |
| HIGH | 4 |
| MEDIUM | 3 |

---

## Next step (validation phase only)

Instrument iOS Safari 375px: Lighthouse LCP, React Profiler during 10s playback, Network cold-load request count, then implement **CRITICAL + HIGH** items one at a time per implementation priority rules in `ranked-bottleneck-report.md`.
