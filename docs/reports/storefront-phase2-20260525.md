# Storefront Phase 2 — 2026-05-25

**Scope:** Features → `ImmersivePreviewModal`, preview-end CTA via `AudioContext.previewEnded`  
**Build:** `npm run build` — **passed** (exit 0)  
**Git:** No commit/push per instructions

---

## Files changed

| File | One-line summary |
|------|------------------|
| `src/app/page.js` | Feature modal state/handlers, second `ImmersivePreviewModal`, deep-link → `openFeatureModal`, auth-defer play for features |
| `src/components/home/FeaturesRail.js` | Cover-only click opens feature modal (`onOpenFeature`); card body no longer sets `nowPlaying` rail |
| `src/components/preview/ImmersivePreviewModal.js` | Wires `PreviewEndedCTA` when `previewEnded` + track slug matches modal item |
| `src/components/preview/PreviewEndedCTA.js` | **New** — preview-end unlock/subscribe/continue-listening surface (design tokens from prior panel CTA) |
| `src/components/preview/immersive/ImmersiveModalPanel.js` | Removed window `preview:ended` listener + inline CTA; accepts `previewEndedCTA` slot from parent |
| `src/context/AudioContext.js` | `previewEnded` / `setPreviewEnded`; set `true` on preview cap/end, reset `false` at top of `playTrack` |

---

## Deviations from spec

| Spec | Actual |
|------|--------|
| State names `featureModalOpen` / `featureModalItem` | Implemented as specified |
| No `useEffect` for play on feature open | Play fires in `openFeatureModal` click handler; **auth-loading defer** still uses shared `useEffect` (same as singles — not a gesture-chain replay) |
| `openFeatureModal`: `playTrack(toPlaybackTrack(...))` | Source string `"feature_modal"` (parallel to `"preview_modal"` for singles) |
| Preview CTA only in `ImmersivePreviewModal` | Panel no longer owns CTA; unlock from CTA does **not** close modal (matches prior panel unlock button) |
| Continue Listening replays preview | `setPreviewEnded(false)` + `playTrack(currentTrack, { resumeAt: 0 })` |

---

## Assumptions vs actual codebase

| Assumption | Finding |
|------------|---------|
| Features used inline `nowPlaying` mini rail only | Confirmed — `handleFeatureClick` set `nowPlaying` + `playTrack`; removed in favor of immersive modal |
| Singles modal pattern is the template | Confirmed — mirrored `openSingleModal` / `closeSingleModal`, mutual close when opening the other modal, no `pause()` on close |
| `ImmersivePreviewModal` accepts feature-shaped catalog items | Confirmed — same `single` prop; features have `slug`, `cover`, `preview`, `price` |
| Preview-end UI lived only in panel | Panel had duplicate logic via `preview:ended` window event; consolidated to context `previewEnded` + `PreviewEndedCTA` |
| Primary subscribe route | `/subscribe` (existing `Link` in codebase) |
| Purchase CTA | `onAddToCart` from page (existing cart flow) |

---

## Acceptance criteria checklist

| Criterion | Status |
|-----------|--------|
| Feature cover opens `ImmersivePreviewModal` | ✅ Cover wrapper `onOpenFeature` |
| `playTrack` in same handler as modal open (no play `useEffect` for features) | ✅ |
| No pause on feature modal close | ✅ `closeFeatureModal` does not call `pause` |
| Second modal rendered alongside singles modal | ✅ `immersive-feature-modal` in `AnimatePresence` |
| `previewEnded` in `AudioContext`, reset on `playTrack`, set on preview end | ✅ |
| `PreviewEndedCTA` component created | ✅ |
| CTA shown when `previewEnded && currentTrack` matches modal item | ✅ |
| Continue Listening clears flag and replays | ✅ |
| Primary CTA: subscribe + unlock (purchase) | ✅ `/subscribe` + `onAddToCart` |
| No changes to `GlobalAudioPlayerBar`, `layout.js`, AV IntersectionObserver | ✅ |
| No playback-core changes beyond `previewEnded` | ✅ |
| `npm run build` exit 0 | ✅ |

---

## Manual QA (recommended)

1. Guest: click feature **cover** → immersive modal + 30s preview; preview-end CTA appears; Continue Listening replays from start.
2. Close feature modal → audio continues in global bar.
3. Open single modal while feature playing (or vice versa) → prior modal closes, new one plays.
4. Deep link `feature` type → opens feature modal on singles tab.
5. Subscriber/owner on feature: full stream path unchanged (no CTA when `canStream`).
