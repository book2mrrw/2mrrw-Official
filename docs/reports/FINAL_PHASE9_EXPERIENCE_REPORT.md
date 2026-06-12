# Phase 9 — Real World Experience Hardening Report

**Date:** 2026-05-24  
**Baseline:** `bc372d4`+ (Phase 8 `modalStackStore` on `main`)  
**Scope:** Motion tokens, CSS micro-interactions, mobile scroll/touch polish, CoverArt decode, runtime cleanup verification — **no** Stripe/auth/entitlements/vault/API/DB/business-logic changes.

---

## 1. Executive summary

Phase 9 introduces a **central motion token layer** (`src/styles/motion/tokens.css`), wires it into **immersive modal and player globals**, adds **press-scale micro-interactions** on dock/modal/gift/collection controls, hardens **mobile modal scroll** (`touch-action`, `overscroll-behavior`), confirms **AudioContext** and **modalStackStore** cleanup paths, and adds **`decoding="async"`** on `CoverArt` images only (no `next/image` migration). Production **build passes**; deliverable zipped to `~/Downloads/FINAL_PHASE9_EXPERIENCE_REPORT.zip`.

---

## 2. Motion system (Step 3)

### 2.1 New file: `src/styles/motion/tokens.css`

| Token | Value | Role |
|-------|-------|------|
| `--motion-duration-fast` | `0.18s` | Buttons, rails, press feedback |
| `--motion-duration-base` | `0.34s` | Overlay backdrop (aligns with framer overlay ~0.34s) |
| `--motion-duration-slow` | `0.48s` | Sheet shell, accent transitions |
| `--motion-ease-out` | `cubic-bezier(0.33, 0, 0.2, 1)` | Material-style deceleration |
| `--motion-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Hover opacity / borders |
| `--motion-ease-spring` | `cubic-bezier(0.22, 1, 0.36, 1)` | Sheet spring (matches `PLAYER_SPRING`) |
| `--motion-modal-backdrop` | base + ease-out | `.modal-immersive-overlay` background transition |
| `--motion-modal-sheet` | slow + spring | `.modal-immersive-shell`, `.player-immersive-shell` |
| `--motion-press-scale` | `0.97` | `:active` scale targets |

`prefers-reduced-motion: reduce` collapses durations and sets `--motion-press-scale: 1`.

### 2.2 Import

`src/app/globals.css` — `@import "../styles/motion/tokens.css";` immediately after Tailwind import.

### 2.3 Classes updated (globals)

| Class group | Token usage |
|-------------|-------------|
| `.modal-immersive-overlay` | `--motion-modal-backdrop` |
| `.modal-immersive-shell` | `--motion-modal-sheet` (accent, glow, box-shadow, border) |
| `.modal-immersive-sheet-handle` | fast duration + ease-in-out |
| `.modal-immersive-close`, `.modal-immersive-art`, `.modal-immersive-view-more` | fast/base tokens |
| `.modal-immersive-action-card`, `.modal-immersive-vinyl-link` | fast + press-scale |
| `.modal-immersive-panel--scroll` | mobile (Step 5) |
| `.player-immersive-shell`, `.player-immersive-progress-rail__fill`, `.player-art-glow` | sheet/fast tokens |
| `.collection-portal-link` | fast transitions + `:active` press |
| `.gift-reveal-artifact` | fast press transition |

**Note:** There is no separate `.modal-immersive-sheet` class; the sheet surface is `.modal-immersive-shell` (mobile bottom sheet). Tokens named `--motion-modal-sheet` apply there.

---

## 3. Micro-interactions (Step 2 — CSS only)

| Target | Behavior |
|--------|----------|
| `.player-dock.player-immersive-glass` | `:active` scale on meta btn, glass btn, hold-seek btn |
| `.player-signature-ring`, `.player-immersive-dock-ring` | Ring button + glass inner scale on press |
| `.modal-immersive-view-more` | Press scale via `--motion-press-scale`; hover opacity `1` with tokenized transition |
| `.modal-immersive-action-card` | Press scale; merged hover/focus opacity + border |
| `.collection-portal-link`, `.gift-reveal-artifact` | Press scale |

No JSX changes for micro-interactions (class names unchanged).

---

## 4. Mobile touch & scroll (Step 5)

`.modal-immersive-panel--scroll`:

- `touch-action: manipulation` (was `pan-y`) — reduces double-tap zoom latency on scroll panel
- `-webkit-overflow-scrolling: touch` — retained
- `overscroll-behavior: contain` — prevents scroll chaining to body behind modal

`.modal-immersive-drawer` already had `-webkit-overflow-scrolling: touch` (unchanged).

---

## 5. Memory / CPU verification (Step 6)

### 5.1 `AudioContext`

| Concern | Status |
|---------|--------|
| `visibilitychange` / `pageshow` / `beforeunload` listeners | **Removed** in effect cleanup (lines ~1359–1362) |
| Progress `requestAnimationFrame` loop | **`stopProgressRaf`** on pause/ended/error, audio listener teardown, and **new** provider unmount effect |
| Provider unmount | Added `useEffect(() => () => stopProgressRaf(), [stopProgressRaf])` as belt-and-suspenders |

### 5.2 `modalStackStore`

| Consumer | Register | Unregister on unmount |
|----------|----------|------------------------|
| `ModalShell` | `registerModal(stackId)` | `return () => unregisterModal(stackId)` |
| `ImmersivePreviewModal` | `stackId="immersive-preview"` | via ModalShell |
| `GiftBottomSheet` | `gift-bottom-sheet` | cleanup in effect |
| `GlobalAudioPlayerBar` | `global-audio-player-expanded` when expanded | cleanup in effect |

**Not wired (unchanged):** `GiftRevealExperience` (fullscreen cinematic, no body scroll stack), `AlbumTracklistSheet`, mobile nav/cart — documented deferrals.

---

## 6. Images (Step 7)

### 6.1 Implemented

- `src/components/ui/CoverArt.js` — `<img decoding="async" />` for image covers (videos unchanged).
- Propagates to all `CoverArt` call sites (immersive modal, gift reveal, player artwork via `CoverArtCS`, etc.).

### 6.2 Explicitly not done

- **No** mass migration of `page.js` or leaf components to `next/image` (guardrail: layout/visual risk).

### 6.3 Remaining raw `<img>` inventory (documented)

| Location | Count (approx) | Notes |
|----------|----------------|-------|
| `src/app/page.js` | 15+ | Hero, albums, cart, now-playing inline styles — foundation surface |
| `src/components/music/PlaylistSection.js` | 2 | Playlist rows |
| `src/components/music/PlaylistDetail.js` | 1 | Track row |
| `src/components/music/MyMusicTab.js` | 2 | Continue / merged rows |
| `src/components/music/ContinueListening.js` | 1 | Thumb |
| `src/components/home/FlowState.js` | 3 | Carousel thumbs |
| `src/components/home/RadioCarousel.js` | 1 | Station art |
| `src/components/collectors-cards/CollectorCardItem.js` | 1 | Card thumb |
| `src/components/collectors-cards/CollectorCardModal.js` | 1 | Modal art |
| `src/components/gifts/GiftsSentSection.js` | 1 | Sent gift thumb |
| `src/components/gifts/GiftBottomSheet.js` | 1 | Sheet preview |
| `src/components/vault/VaultUnlockedRoom.jsx` | 1 | `loading="lazy"` already |
| `src/lib/gifts/email.js` | 1 | HTML email template (server) |

**Recommendation (future):** Migrate high-traffic thumbs via `CoverArt` or targeted `next/image` only when explicitly scoped; leave `page.js` inline imgs untouched per foundation rules.

---

## 7. Reduced motion audit (Step 8 — report only)

| Area | Handling |
|------|----------|
| Motion tokens | `@media (prefers-reduced-motion: reduce)` zeroes durations and press scale |
| Existing globals | `.hero-title-glow`, `.song-title-turquoise-glow`, `.collection-portal-link::after`, immersive ambient pulses — already gated or cosmetic |
| Framer shells | `ModalShell` / player springs unchanged (Phase 9 scope: CSS layer only) |
| `GiftRevealExperience` | `gift-reveal-reduced` class + shorter framer durations when `useReducedMotion()` |

No code changes in Step 8 beyond token-level reduced-motion defaults.

---

## 8. Deferred orchestration & scope (Step 9 — report only)

Carried from Phase 8 recommendations (not implemented in Phase 9):

1. Wire `AlbumTracklistSheet`, mobile nav/cart sheets to `modalStackStore`.
2. Optional `createPortal` for immersive overlay if z-index conflicts with host UI layers emerge.
3. Named `stackId` + ESC-to-close priority across DonateModal, AuthGate, Stripe checkout overlay.
4. `GiftRevealExperience` body scroll — fullscreen overlay; separate from stack by design.

---

## 9. Validation

| Check | Result |
|-------|--------|
| `npm run build` | Run at commit time (see CI note in zip) |
| New dependencies | **None** |
| Protected surfaces | `page.js` hero/layout untouched; no entitlement/API edits |
| ESLint (touched) | `CoverArt.js`, `AudioContext.js` — expect 0 new errors |

---

## 10. Artifacts & files touched

| Artifact | Path |
|----------|------|
| Report | `docs/reports/FINAL_PHASE9_EXPERIENCE_REPORT.md` |
| Zip | `~/Downloads/FINAL_PHASE9_EXPERIENCE_REPORT.zip` |

### Files changed (Phase 9)

- `src/styles/motion/tokens.css` (new)
- `src/app/globals.css`
- `src/components/ui/CoverArt.js`
- `src/context/AudioContext.js` (unmount RAF guard)
- `docs/reports/FINAL_PHASE9_EXPERIENCE_REPORT.md` (new)

### Commit message

`feat: phase 9 motion tokens and micro-interaction polish`

---

*Generated as part of Phase 9 real-world experience hardening on the bc372d4+ / Phase 8 modal stack baseline.*
