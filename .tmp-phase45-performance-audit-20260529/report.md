# PHASE 4.5 — Elite Streaming Responsiveness + Perceived Performance Audit

**Platform:** 2MRRW artist-platform  
**Commit:** c31536e (Mixtapes & EPs + mobile clone)  
**Production:** https://www.2mrrw.com  
**Audit date:** 2026-05-29  
**Mode:** Read-only baseline — **zero source modifications**

---

## Executive summary

This audit establishes a performance baseline for the cinematic storefront + streaming stack before any optimization work. Analysis combined production build output (`npm run build`, Next.js 16.2.4 Turbopack), static chunk inspection (`.next/static/chunks`), and code-path tracing across playback, media resolution, hydration, and mobile Safari constraints.

The platform is architecturally sound for its goals (single `<audio>` element, redirect fast-path streaming, R2 nested media, entitlement-gated `/api/library/stream`). The dominant perceived-performance risks are **client-side React churn during playback**, **monolithic client shell bundling**, and **concurrent MP4 decode + GPU blur pressure on mobile Safari** — not fundamental playback pipeline design.

Production performance marks exist only in development (`src/lib/dev/performanceMarks.js`); live Core Web Vitals were not captured in this pass. Validation phase should instrument tap→audible, LCP hero video, and scroll FPS on real iOS Safari at 375px.

---

## Top findings (ranked by impact)

| Rank | Finding | Impact | Primary files |
|------|---------|--------|---------------|
| 1 | **AudioContext progress RAF drives ~60fps `setState`** — all `useAudioPlayer` consumers re-render every frame during playback | High — UI jank, battery, scroll stutter while playing | `src/context/AudioContext.js` (L532–548, L2868–2936) |
| 2 | **Monolithic client `page.js` (~2,778 lines)** — entire storefront shell, framer-motion, Stripe Elements, admin panel in one `"use client"` tree | High — JS parse/hydrate cost, TTI | `src/app/page.js`, `src/app/layout.js` |
| 3 | **Concurrent MP4 decodes + heavy CSS blur** — hero `preload="auto"`, singles carousel videos, ambient background `blur(120px)` | High — mobile Safari memory/GPU, LCP | `src/app/page.js` (L1783), `src/components/home/LatestSinglesStyleRow.js`, `src/components/home/AmbientPlaybackBackground.js` |
| 4 | **Main scroll drives React state on every scroll event** (`setHeroScrollY`) | Medium–High — hero parallax re-renders entire page tree | `src/app/page.js` (L657–662, L1778–1790) |
| 5 | **Root layout loads full provider stack on every route** (Auth, Audio, Stripe, PostHog, SW) | Medium — shared ~2.74MB client chunks | `src/app/layout.js` |
| 6 | **Stream JSON path adds serial HEAD probe** after `/api/library/stream` JSON | Medium — extra RTT when non-redirect path used | `src/lib/playback/stream-client.js` (L25–47, L202) |
| 7 | **Catalog bootstrap blocks paint** — `cache: "no-store"` fetch on mount | Medium — singles row delayed | `src/app/page.js` (L698–706) |
| 8 | **No `@next/bundle-analyzer`** — route-level weight opaque | Medium — planning friction | `package.json` |
| 9 | **Admin panel statically imported in storefront page** | Low–Medium — dead code in fan bundle | `src/app/page.js` (L17) |
| 10 | **Perf instrumentation dev-only** | Low — no prod regression guard | `src/lib/dev/performanceMarks.js` |

---

## Protected systems (no rewrite recommendations)

Per scope: canonical metadata, nested R2 media, playback pipeline, queue, storefront resolver, MP4 loops, mobile playback, entitlements remain intact. Remediation items in `prioritized-remediation-plan.md` target leaf optimizations with measurement plans and rollback paths only.

---

## Build snapshot

```
Next.js 16.2.4 (Turbopack) — compiled in 11.9s
Static routes: /, /subscribe, /login, /join, /verify-otp, /success, /collectors-cards, /collector/activate
Dynamic: /album/[slug], /song/[slug], /feature/[slug], /gift/[token]
Client chunks: 35 files, ~2.74 MB total (uncompressed)
Largest chunks: ~407 KB × 2, ~329 KB (framer-motion+stripe), ~211 KB (supabase), ~184 KB (posthog)
```

---

## Section index

| File | Topic |
|------|-------|
| `01-initial-load.md` | FCP, LCP, TTI, hydration, bundles |
| `02-interaction-latency.md` | Tap, modal, route, scroll |
| `03-audio-start-latency.md` | Tap→play→URL→audible |
| `04-media-timing.md` | Artwork, MP4, resolver, signed URLs |
| `05-react-churn.md` | Render hotspots |
| `06-network-waterfall.md` | Serial chains, duplicates |
| `07-mobile-safari.md` | Memory, visibility, background |
| `08-mp4-loop-audit.md` | Decode pressure |
| `09-image-optimization.md` | CDN, compression |
| `10-client-hydration-audit.md` | `"use client"` boundaries |
| `11-context-churn-audit.md` | Context rerenders |
| `12-bundle-splitting.md` | Route chunks, leakage |
| `13-animation-gpu.md` | Blur, compositing |
| `14-layout-stability.md` | CLS |
| `15-realtime-subscriptions.md` | SSE / Supabase |
| `16-scroll-performance.md` | Nested scroll |
| `17-playback-continuity.md` | Remounts, media session |
| `18-media-resolution-timing.md` | Resolver duplication |
| `prioritized-remediation-plan.md` | Ranked fixes (no implementations) |
| `manifest.txt` | Files analyzed |

---

## Validation phase (recommended probes)

1. **iOS Safari 375px:** Lighthouse + WebPageTest filmstrip; LCP element = hero MP4 or text
2. **Tap→audible:** `performance.mark` in prod sample for entitled vs preview tracks
3. **Scroll while playing:** Chrome Performance panel — main thread vs compositor during `page.js` scroll + playback
4. **Memory:** Safari Web Inspector — video element count on Home tab with 10+ singles
5. **Network:** DevTools waterfall for first play — count hops to first audio byte
