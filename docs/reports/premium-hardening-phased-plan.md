# Premium Media Platform Hardening — Phased Plan

**Date:** 2026-05-24  
**HEAD at plan time:** `91ba6c7` — useMediaEngine subscription layer; AudioContext remains single engine  
**Principle:** Stabilize in place. **Do not rebuild** parallel engines, modal providers, or TypeScript media cores.

---

## Verified foundation (already on HEAD)

| Invariant | Commit / evidence |
|-----------|-------------------|
| Single `<audio>` + RAF progress in `AudioContext` | `9095d56` |
| `useMediaEngine` + `mediaEngineBridge` (no second `Audio()`) | `91ba6c7` |
| `ModalShell`, layered `ImmersivePreviewModal` | `fb1f164`, `703e966` |
| `LivePanel` / `FlowState` / `RadioCarousel` extracted from `page.js` | `fb1f164` |
| `useCoverPalette` hook fixes | prior session / audit docs |

---

## DO NOT REBUILD (explicit reject list)

These paths **violate** user invariants and must not be started without a new scoped approval:

| Proposed path | Why rejected |
|---------------|--------------|
| `src/media/core/MediaEngine.ts` with second `Audio()` | Duplicates `AudioContext`; breaks single-engine invariant |
| Full `src/modals/ModalProvider` rewrite | Replaces working `ModalShell` + `ImmersivePreviewModal` layering |
| TypeScript migration of media layer | Large churn; no playback bug tied to JS vs TS |
| Stripe / entitlements / Vault / auth changes | Out of scope; entitlements must stay webhook → Supabase → `/api/account/state` |
| New design system | Guardrails: cinematic UI is foundation baseline |
| `why-did-you-render` unless opt-in devDependency | Noise + bundle risk |
| Rewriting `GlobalAudioPlayerBar` architecture | Already delegates to `ImmersivePlayerEngine` + `useImmersivePlayback`; `scaleX` rails in `CompactDockPlayer` / `FloatingMainPlayer` |

---

## Phase A — Code (this session)

### Done

| # | Task | Result |
|---|------|--------|
| 1 | Quarantine `ModalAudioPlayer.js` | Moved to `src/components/media/_deprecated/ModalAudioPlayer.js` (zero `src/` imports) |
| 2 | Progress bar GPU path | **PreviewModalPlayer:** `width%` → `scaleX` + `overflow:hidden` on rail. **GlobalAudioPlayerBar:** already uses `player-immersive-progress-rail__fill` with `scaleX` via dock/floating children — no change |
| 3 | `page.js` derived state (≤5) | (a) `myPurchases` → `useMemo(() => library \|\| [], [library])`; (b) removed mirrored `currentUser` state — use `useAuth().currentUser` directly; (c) cart hydrate → `useState` lazy init from `localStorage`; removed 3 mirror/hydrate `useEffect`s |
| 4 | `OptimizedArtwork.js` | **Skipped** — `CoverArt` uses `<img>` / `<video>`, not `next/image`; wrapper adds indirection without benefit |

### Skipped (Phase A)

| Item | Reason |
|------|--------|
| `GlobalAudioPlayerBar` progress change | Already `transform: scaleX(${progress / 100})` in `CompactDockPlayer.js` / `FloatingMainPlayer.js` |
| `OptimizedArtwork` wrapper | No existing `next/image` artwork path to delegate to |
| `circleSubmissions` localStorage hydrate → lazy init | Valid but lower impact; left as one-shot `useEffect` to stay under churn budget |
| `exclusiveCatalog` / `printfulProducts` fetch effects | Async I/O, not derived-state mirrors |

---

## Phase B — Roadmap (documentation only)

### B1. Modal portal root

- **Today:** Modals mount in React tree; z-index in `globals.css` (e.g. preview overlay 8888, player 8500–9200).
- **Target:** Optional `#modal-root` (or `document.body` portal) for focus trap and stacking context — **without** replacing `ModalShell` API.
- **Files:** `src/components/modals/ModalShell.js`, `src/app/layout.js`, `src/app/globals.css`.

### B2. Gesture system

- **Today:** Touch handlers on `GlobalAudioPlayerBar` / `FloatingMainPlayer`; preview modal uses `ImmersivePreviewModal` hooks.
- **Target:** Shared `useModalSwipeDismiss` / `usePlayerExpandGesture` module — extract only, no behavior change.
- **Files:** `src/lib/player/gestures.js` (new), consumers in `GlobalAudioPlayerBar.js`, `ImmersivePreviewModal.js`.

### B3. Immersive canvas split

- **Today:** Atmosphere in `PlayerAtmosphere`, CSS `.modal-immersive-*`, `AmbientArtworkBackground`.
- **Target:** Single “canvas layer” component for blur/vignette behind modal + expanded player — visual parity, smaller `page.js` surface.
- **Files:** `src/components/player/ImmersiveCanvas.js` (new leaf), `globals.css` token pass only if needed.

### B4. MediaEngine TypeScript core

- **Deferred indefinitely** unless single-engine bridge proves insufficient. Current bridge: `src/media/MediaEngine.js`, `mediaEngineBridge.js`, `useMediaEngine.js`.

---

## Master prompt sections 1–10 → repo map

| Section | Master intent | Existing home | Phase |
|---------|---------------|-----------------|-------|
| 1 | Single audio engine | `src/context/AudioContext.js`, `src/media/mediaEngineBridge.js` | **Done** (`9095d56`, `91ba6c7`) |
| 2 | RAF / transform progress | `AudioContext` RAF; `CompactDockPlayer`, `FloatingMainPlayer`, `PreviewModalPlayer` | **A done** (preview bar) |
| 3 | Modal layering | `ModalShell`, `ImmersivePreviewModal`, `PreviewModalPlayer` | **Done** |
| 4 | Extract home sections | `LivePanel`, `FlowState`, `RadioCarousel` | **Done** |
| 5 | Cover / palette | `CoverArt`, `useCoverPalette`, `music-playback` | **Done** |
| 6 | Dead player removal | `_deprecated/ModalAudioPlayer.js` | **A done** |
| 7 | Derived state on `page.js` | `useMemo` / auth `currentUser` / cart lazy init | **A done** |
| 8 | Portal + gestures | — | **B** |
| 9 | Immersive canvas | CSS + `PlayerAtmosphere` | **B** |
| 10 | TS MediaEngine / ModalProvider | — | **Rejected** |

---

## Uncommitted / workspace notes

- `src/media/*` and player diffs from prior media-engine work may exist on the branch; this Phase A commit is scoped to hardening items above only.
- Audit zips and `docs/reports/*` snapshots are intentionally not part of the Phase A commit.

---

## Verification checklist

- [ ] `npm run build` passes
- [ ] No `import` of `ModalAudioPlayer` in `src/`
- [ ] Preview modal scrubber animates via `scaleX`
- [ ] Sign-out clears purchases via `library` from auth, not local mirror
- [ ] Cart persists via lazy init + existing `useEffect` write-through
