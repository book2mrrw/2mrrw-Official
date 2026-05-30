# Prioritized Remediation Plan

**Phase:** Planning only — no implementations in Phase 4.5  
**Ordering:** Impact × confidence ÷ risk

---

## P0 — Critical perceived performance

### P0-1: Decouple playback progress from AudioContext provider value

| Field | Detail |
|-------|--------|
| **Issue** | `currentTime` updates via RAF `patchState` ~60/s, re-rendering all `useAudioPlayer` consumers |
| **Root cause** | `state` spread into context value (`AudioContext.js` L2868, L532–548) |
| **Files** | `src/context/AudioContext.js`, `src/components/audio/GlobalAudioPlayerBar.js`, consumers |
| **Expected gain** | 50–90% reduction in React commits during playback; smoother scroll/interaction while playing |
| **Risk** | Medium — scrubber/sync components must migrate to ref/subscription pattern |
| **Rollback** | Revert AudioContext value split; single provider restore |
| **Validation** | React Profiler: Page commits during 10s playback (target: <5 vs ~600) |

### P0-2: Remove scroll-linked React setState for hero parallax

| Field | Detail |
|-------|--------|
| **Issue** | `setHeroScrollY` on every scroll event re-renders 2,778-line Page |
| **Root cause** | `page.js` L657–662, hero styles L1787–1788 tied to React state |
| **Files** | `src/app/page.js` |
| **Expected gain** | Scroll FPS +10–20 on mid mobile; reduced main-thread jank |
| **Risk** | Low — move transforms to CSS variables updated via ref |
| **Rollback** | Restore setState scroll handler |
| **Validation** | Performance panel: Scripting time during 3s fling scroll |

### P0-3: Hero MP4 preload policy + concurrent video budget

| Field | Detail |
|-------|--------|
| **Issue** | Hero `preload="auto"` + carousel videos compete for bandwidth/decode |
| **Root cause** | `page.js` L1783; multiple `<video>` without global budget |
| **Files** | `src/app/page.js`, `src/components/home/LatestSinglesStyleRow.js` |
| **Expected gain** | LCP −200–800ms; lower Safari memory kills |
| **Risk** | Low — visual: hero may show poster briefly |
| **Rollback** | Restore preload="auto" |
| **Validation** | Lighthouse LCP; Safari memory with 15 singles |

---

## P1 — High impact

### P1-1: Tab-level dynamic imports in storefront

| Field | Detail |
|-------|--------|
| **Issue** | All tabs (Vault, Shop, Cards, modals) in initial page bundle |
| **Root cause** | Monolithic static imports in `page.js` |
| **Files** | `src/app/page.js` |
| **Expected gain** | Initial JS −100–300 KB parsed; faster TTI |
| **Risk** | Low — pattern exists (DonateModal dynamic) |
| **Rollback** | Revert dynamic imports to static |
| **Validation** | First-load JS bytes; TTI on 3G Fast |

### P1-2: Dynamic import CollectorCardAdminPanel

| Field | Detail |
|-------|--------|
| **Issue** | Admin code in fan bundle despite conditional render |
| **Root cause** | Static import L17 |
| **Files** | `src/app/page.js`, `src/components/admin/CollectorCardAdminPanel.js` |
| **Expected gain** | −5–30 KB gzip for non-admin users |
| **Risk** | Very low |
| **Rollback** | Static import restore |
| **Validation** | Bundle analyzer: admin chunk separate |

### P1-3: Defer non-visible tab API fetches

| Field | Detail |
|-------|--------|
| **Issue** | Printful, exclusive-drops fetch on mount regardless of tab |
| **Root cause** | `page.js` L864, L899 useEffects not tab-gated |
| **Files** | `src/app/page.js` |
| **Expected gain** | −2–4 requests on initial load; faster catalog path |
| **Risk** | Low — shop tab shows loading briefly |
| **Rollback** | Restore mount effects |
| **Validation** | Network request count before interactive |

### P1-4: Reduce AmbientPlaybackBackground blur cost

| Field | Detail |
|-------|--------|
| **Issue** | `blur(120px)` on full-viewport video during playback |
| **Root cause** | `AmbientPlaybackBackground.js` L22 |
| **Files** | `src/components/home/AmbientPlaybackBackground.js` |
| **Expected gain** | GPU compositing −30–50%; better scroll FPS while playing |
| **Risk** | Low–medium — aesthetic change requires approval |
| **Rollback** | Restore blur(120px) |
| **Validation** | Safari FPS during playback with ambient active |

---

## P2 — Medium impact

### P2-1: Skip HEAD probe on stream JSON path

| Field | Detail |
|-------|--------|
| **Issue** | Extra serial HEAD after JSON stream fetch |
| **Root cause** | `stream-client.js` L202 `assertSignedAudioUrl` |
| **Files** | `src/lib/playback/stream-client.js` |
| **Expected gain** | −50–200ms when JSON path used (visibility refresh) |
| **Risk** | Low — server already validates on proxy |
| **Rollback** | Re-enable HEAD assert |
| **Validation** | HAR: visibility refresh stream path |

### P2-2: Production perf sampling (extend performanceMarks)

| Field | Detail |
|-------|--------|
| **Issue** | tap→audible, modal open timing dev-only |
| **Root cause** | `performanceMarks.js` L27–32 NODE_ENV gate |
| **Files** | `src/lib/dev/performanceMarks.js`, PostHog adapter |
| **Expected gain** | Regression detection; no user-facing perf change |
| **Risk** | Low — sample rate 1–5% |
| **Rollback** | Disable prod marks |
| **Validation** | PostHog events for audio-start-latency p50/p95 |

### P2-3: Add @next/bundle-analyzer to CI

| Field | Detail |
|-------|--------|
| **Issue** | No automated bundle regression detection |
| **Root cause** | Missing from package.json |
| **Files** | `package.json`, CI config |
| **Expected gain** | Process improvement |
| **Risk** | None (tooling only) |
| **Rollback** | Remove script |
| **Validation** | PR comment with chunk diff |

### P2-4: Consolidate refreshLibrary + refreshAccountState

| Field | Detail |
|-------|--------|
| **Issue** | Paired calls duplicate library fetch |
| **Root cause** | page.js callbacks L1841–1842; AuthContext separate methods |
| **Files** | `src/context/AuthContext.js`, `src/app/page.js` |
| **Expected gain** | −1 API call per library action |
| **Risk** | Low — ensure account state still syncs |
| **Rollback** | Restore dual refresh |
| **Validation** | Network on add-to-library flow |

---

## P3 — Lower priority / measure first

### P3-1: Replace hard nav Subscribe with Next Link

| Field | Detail |
|-------|--------|
| **Issue** | `window.location.href` breaks playback continuity |
| **Root cause** | page.js L1805 |
| **Files** | `src/app/page.js` |
| **Expected gain** | Playback continuity; slightly faster nav |
| **Risk** | Low |
| **Rollback** | Restore hard nav |
| **Validation** | Audio continues through subscribe nav |

### P3-2: ImmersivePreviewModal — static opacity backdrop vs animated backdrop-filter

| Field | Detail |
|-------|--------|
| **Issue** | Animating backdrop-filter during modal open |
| **Root cause** | ImmersivePreviewModal.js L568–570 |
| **Files** | `src/components/preview/ImmersivePreviewModal.js` |
| **Expected gain** | Smoother modal open on Safari |
| **Risk** | Medium — visual change needs approval |
| **Rollback** | Restore blur animation |
| **Validation** | Frame count modal open |

### P3-3: Responsive cover URLs / srcset

| Field | Detail |
|-------|--------|
| **Issue** | Full-size covers on mobile |
| **Root cause** | No next/image or srcset |
| **Files** | `CoverArt.js`, CDN pipeline |
| **Expected gain** | −30–60% image bytes on mobile |
| **Risk** | Medium — CDN/transform pipeline needed |
| **Rollback** | Single URL |
| **Validation** | Bytes transferred for 375px cards |

---

## Explicitly out of scope (protected)

- Rewriting AudioContext playback command architecture
- Replacing R2 nested media / entity-resolver
- Removing cinematic MP4 hero system
- Client-side entitlement overrides
- Dependency bumps without approval

---

## Suggested execution order

1. P0-1 → P0-2 → P0-3 (measure each before next)
2. P1-1 + P1-2 (bundle wins)
3. P1-3 + P1-4 (network/GPU)
4. P2-* as instrumentation and polish
5. P3-* only with measurement proof
