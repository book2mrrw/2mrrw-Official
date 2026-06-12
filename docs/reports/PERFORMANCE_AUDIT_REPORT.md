# Performance Audit Report — Premium Platform Evolution (Phase 1)

**Date:** 2026-05-24  
**Base stack:** `37dac20` → `FINAL_PLATFORM_STABILIZATION_REPORT` (`64192d3`)  
**Scope:** Read-only profiling + documented hotspots. No Stripe/auth/entitlements/gifting/vault/webhook/admin changes.

---

## Executive summary

The stabilization stack is **already strong** on the highest-risk paths: `AudioContext` provider `value` is `useMemo`-wrapped, leaf players use `React.memo`, and dev render tracking is gated. Remaining cost is dominated by **`page.js` surface area** (~2,784 lines / ~190 KB), **broad `state` spread into context value** (any playback tick re-renders all `useAudioPlayer` subscribers), and **18 framer-motion entry points** (modal shell + home + gifts). This pass adds **cover preload**, **observability**, **CSS palette/backdrop polish**, and **error boundary** without a second `Audio()` or route-level splits.

---

## AudioContext provider

| Check | Result |
|-------|--------|
| Provider `value` memoized | **Yes** — `useMemo` at ~L1434 with explicit callback/state deps |
| Single `<audio>` | **Yes** — sole element in provider return |
| `playTrack` stable | **Yes** — `useCallback` with bounded deps |

**Hotspot:** `value` spreads full `state` object. RAF/throttled progress updates still replace `state`, so **every subscriber re-renders** on time updates unless they subscribe via `useMediaEngine` bridge or narrow selectors (future Phase B).

**Recommendation:** Keep `useMediaEngine` for modal/player leaves; avoid adding new `useAudioPlayer()` consumers on hot paths. Optional later: split `AudioPlaybackStateContext` vs actions (document-only until scoped).

---

## useRenderTracker (dev-only)

| Component | Path |
|-----------|------|
| `ImmersivePreviewModal` | `src/components/preview/ImmersivePreviewModal.js` |
| `PreviewPlayerControls` | `src/components/preview/immersive/PreviewPlayerControls.js` |
| `GlobalAudioPlayerBar` | `src/components/audio/GlobalAudioPlayerBar.js` |

Hook: `src/lib/dev/useRenderTracker.js` — no-op when `NODE_ENV !== "development"`. Logs mount + every 10th render.

**Recommendation:** Add tracker to `CompactDockPlayer` only if dock re-render counts exceed modal during QA.

---

## Context inventory

| Context | Lines | `value` memoized |
|---------|-------|------------------|
| `AudioContext` | ~1,508 | Yes |
| `AuthContext` | ~299 | Yes |
| `AuthGateContext` | ~36 | Yes |
| `CartContext` | small | No (`useState` only) |

---

## page.js & framer-motion

| Metric | Value |
|--------|-------|
| `src/app/page.js` lines | **2,784** |
| `page.js` bytes | **~194 KB** |
| `framer-motion` imports in `src/` | **18 files** |

**Hotspots:** Home still centralizes catalog/modal orchestration; motion on `page.js`, `ModalShell`, gifts, subscribe, collectors cards.

**Recommendations (no rebuild):**

1. Continue leaf extraction (already: `LivePanel`, `FlowState`, `RadioCarousel`) — do not split routes without explicit approval.
2. Prefer CSS transitions (`globals.css` modal tokens) over new motion wrappers where parity allows.
3. Defer `why-did-you-render` / React Compiler experiments.

---

## Modal / player render path

| Component | memo | Stable callbacks |
|-----------|------|------------------|
| `PreviewPlayerControls` | `memo` | `useCallback` seek/toggle |
| `CompactDockPlayer` | `memo` | props from parent |
| `ImmersivePreviewModal` | `memo` | handlers `useCallback`; close buttons stabilized this pass |
| `ModalShell` | `memo` | overlay/shell motion constants |

Progress bars use **scaleX** transform (GPU-friendly) on active paths per stabilization report.

---

## CSS / motion (Phase 3 touchpoints)

- Modal overlay: softer backdrop transition in `.modal-immersive-overlay`
- Palette: `@property --modal-accent` + shell transition for crossfade on cover change
- Safe-area: `padding-top: env(safe-area-inset-top)` on `.modal-immersive-shell`

---

## Preload (Phase 5)

- `src/lib/media/preload.js` — `<link rel="preload" as="image">` + abortable `fetch` for cache warm
- Wired **only** from `AudioContext.playTrack` — images only, no signed stream URLs

---

## Dev tooling added

- `src/lib/dev/performanceMarks.js` — `performance.mark` / `measure` wrapper (dev-only)

---

## Priority matrix

| Priority | Item | Effort |
|----------|------|--------|
| P0 | Keep single audio engine invariant | Done |
| P1 | Cover image preload on `playTrack` | Done (this pass) |
| P1 | Context subscriber discipline (`useMediaEngine`) | Ongoing |
| P2 | Narrow `page.js` state / effects | Roadmap |
| P2 | Portal root for modals | Roadmap (premium-hardening Phase B) |
| P3 | Route-level code splitting | Deferred (gift reveal only if trivial) |

---

## Verification commands

```bash
npm run lint -- --max-warnings 0 src/
npm run build
```

In dev: open preview modal and watch `[render] ImmersivePreviewModal: #N` every 10th render.
