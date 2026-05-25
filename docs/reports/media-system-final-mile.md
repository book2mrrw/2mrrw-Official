# Media System — Final Mile Verification

**Repo:** `/Users/recharge/artist-platform`  
**Report date:** 2026-05-24  
**Mode:** Read-only verification + documentation (no code changes)

---

## Git reference

| Item | Value |
|------|--------|
| **HEAD** | `703e966d4c863cdfa9fcb99041d0acc55d70e796` |
| **Branch context** | Stability stack on current working tree |

### Relevant commits (newest first)

| Hash | Subject | Scope |
|------|---------|--------|
| `703e966` | fix: media modal polish — stable callbacks, throttled progress, persistent modal mount | `AudioContext`, `page.js` modal wiring, `ImmersivePreviewModal`, `GlobalAudioPlayerBar`, `PreviewPlayerControls`, `usePlayerBodyState` |
| `fb1f164` | fix: modal shell persistence, extract inline components, layer-based views | `ModalShell`, extract `FlowState` / `LivePanel` / `RadioCarousel`, layer-based `ImmersivePreviewModal` |
| `37dac20` | fix: single audio engine — remove duplicate playback, stabilize modal hooks | Remove duplicate `<audio>` on `page.js`, preview via `AudioContext`, hook order fixes |

---

## Section A — Master prompt (polish pass rules, condensed)

**Intent:** Surgical perceived-quality pass only. **Not** an architecture rewrite, **not** a visual redesign, **no** new libraries.

**Build on:** `fb1f164` (ModalShell + extracted home sections), `37dac20` (single `AudioContext` audio element).

### Hard constraints

- Do **not** touch: Stripe, auth, purchases backend, upload/R2, release CMS, analytics.
- Do **not** change layout, spacing, colors, typography, or motion design language.
- Scope files (max): `AudioContext.js`, `ImmersivePreviewModal.js`, `ModalShell.js`, `GlobalAudioPlayerBar.js`, `page.js` (modal open + preview props only), `useImmersivePlayback.js` if needed.

### Five layers (surgical only)

1. **Render stability** — `useCallback` for handlers passed to modals/player; `useMemo` for style objects; no inline component props like `header={<X />}`.
2. **Modal stability** — Stable modal mount key; separate open state from track identity; track change must **not** remount shell; scroll lock once on open, cleanup on close.
3. **Audio polish** — Change `src`/load only when track id/slug changes; throttle `currentTime` updates (~250ms); expose/use `isBuffering` separately from `isPlaying`.
4. **Animation continuity** — Stable keys on persistent layers; prefer transform/opacity over layout animations; minimal `AnimatePresence` churn.
5. **State cleanliness** — UI reads `AudioContext` only; no duplicate mirrored playback state or redundant sync loops in preview/page.

### Success criteria

- `npm run build` passes.
- Scoped lint clean on touched player/modal files.
- Commit message: `fix: media modal polish — stable callbacks, throttled progress, persistent modal mount`.

---

## Section B — Post-fix audit checklist (manual QA)

Use on **desktop + mobile** after deploy or `npm run dev`. Mark each: **Pass / Fail / TBD**.

### A. Single audio authority

| # | Test | Notes |
|---|------|--------|
| B1 | Open immersive preview from Singles carousel → only one track audible | No double audio |
| B2 | With preview open, global dock plays different library track → preview/global behavior is predictable | Document expected: global engine owns playback |
| B3 | Close preview → global bar still reflects last global track state | No stuck modal audio |
| B4 | Rapid open/close preview 5× → no orphan audio, no console errors | |
| B5 | Switch preview track while modal stays open → shell does not flash/remount | Stable `key="immersive-preview-modal"` |

### B. Global player (dock / expanded)

| # | Test | Notes |
|---|------|--------|
| B6 | Play from library → dock shows artwork, title, scrubber | |
| B7 | Scrub while playing → smooth bar, no runaway re-renders (jank check) | Throttled progress in context |
| B8 | Buffer/spinner shows on slow stream, clears when playing | `isBuffering` wired |
| B9 | Pause/resume from dock and from preview controls → same engine state | |
| B10 | CS mode (if enabled) → hold/release restores prior playback | |

### C. Immersive preview modal

| # | Test | Notes |
|---|------|--------|
| B11 | Open preview → body scroll locked; close → scroll restored | `usePlayerBodyState` |
| B12 | Drag sheet down / dismiss gesture → closes once, no stuck overlay | |
| B13 | View More drawer → open/close without closing modal | |
| B14 | Glyphs/lyrics panel → syncs with playback time | `useAudioPlayer` in lyrics |
| B15 | Add to cart / gift from modal → works, modal closes as designed | |
| B16 | Cover palette glow matches artwork (not default cyan only) | `useCoverPalette` |
| B17 | Mobile vs desktop layers — correct layout, no duplicate atmosphere | layer keys |

### D. Home page / carousel (non-modal)

| # | Test | Notes |
|---|------|--------|
| B18 | Singles carousel MP4 — plays in view, pauses out of view | IntersectionObserver path |
| B19 | Hero / ambient video — no fight with modal audio | |
| B20 | `FlowState`, `LivePanel`, `RadioCarousel` render without remount flicker on tab change | Extracted modules |

### E. Regression guardrails

| # | Test | Notes |
|---|------|--------|
| B21 | Auth gate / join flow unchanged | Protected scope |
| B22 | Cart / Stripe checkout unchanged | Protected scope |
| B23 | Vault / entitlements — locked content stays locked in preview | `trackAccess` |
| B24 | Gift reveal overlay stacks above player (z-index) | gift ~99990 |
| B25 | Reduced motion preference — no mandatory layout animation failures | `useReducedMotion` where used |

---

## Section C — Final architecture map

### ASCII — runtime surfaces

```
┌─────────────────────────────────────────────────────────────────────────┐
│  src/app/layout.js                                                       │
│    └── GlobalAudioPlayerBar ──► ImmersivePlayerEngine (dock / expanded) │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AudioContext.js  ◄── CANONICAL ──►  <audio> (single element in src/)   │
│    • playTrack / toggle / queue / Media Session                          │
│    • throttled currentTime (250ms)                                       │
│    • isPlaying, isBuffering, stream retry                                │
└─────────────────────────────────────────────────────────────────────────┘
          ▲                                    ▲
          │ useAudioPlayer()                   │ useImmersivePlayback()
          │                                    │
┌─────────┴──────────┐              ┌─────────┴──────────────────────────┐
│ GlobalAudioPlayerBar│              │ ImmersivePreviewModal               │
│ (site-wide chrome)  │              │   ModalShell (backdrop, dismiss)    │
│                     │              │   PlayerAtmosphere                  │
│                     │              │   PreviewModalPlayer / Controls     │
└─────────────────────┘              │   useCoverPalette → CSS vars      │
                                     └────────────────────────────────────┘
                                                  ▲
                                     page.js: previewModalOpen + selectedSingle
                                     key="immersive-preview-modal" (stable)

┌─────────────────────────────────────────────────────────────────────────┐
│  page.js (home SPA) — video only for carousel/hero (HTML5 <video>)       │
│    FlowState / LivePanel / RadioCarousel → @/components/home/*           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data flow rules

1. **One `<audio>` in `src/`** — lives in `AudioContext`; preview and dock are UI consumers only.
2. **Playback API** — `playTrack`, `toggle`, `seek` via context; preview uses `useImmersivePlayback` adapter.
3. **Modal open** — `previewModalOpen` boolean separate from `selectedSingle`; effect keys off slug for playback, not full release hydration.
4. **Entitlements** — `trackAccess` from account state; never client-side permission overrides.
5. **Palette** — `useCoverPalette(coverSrc, coverType)` unconditional at top of modal; early `if (!single) return null` only after all hooks.
6. **Orphan** — `ModalAudioPlayer.js` unused; safe to archive (not in live path).

### Z-index ladder (reference)

| Layer | Approx. z-index |
|-------|-----------------|
| Player atmosphere | 8870 |
| Immersive modal overlay | 8888 |
| Player island / expanded | 9000 / 8500 |
| Auth overlay | 9500 |
| Gift reveal | 99990 |

---

## Section D — Current repo status vs checklist

**Verification run:** 2026-05-24 (automated grep + `npm run lint` + `npm run build`)

### D.1 Automated grep checks (post `703e966`)

| Check | Expected | Result | Status |
|-------|----------|--------|--------|
| `<audio>` count in `src/` | 1 | **1** (`src/context/AudioContext.js:1439`) | **PASS** |
| `page.js` duplicate `<audio>` / `modalAudioRef` | None | **0** matches | **PASS** |
| `ImmersivePreviewModal` mount key in `page.js` | Stable string key, not slug | `key="immersive-preview-modal"` | **PASS** |
| Track change remounts modal shell | No `key={selectedSingle.slug}` on modal | Absent | **PASS** |
| `FlowState` / `LivePanel` / `RadioCarousel` inline in `page.js` | Extracted modules | Imports from `@/components/home/*`; no inline definitions | **PASS** |
| `useCoverPalette` conditional (Rules of Hooks) | Unconditional hook order | Called at L152; `if (!single) return null` at L272 (after hooks) | **PASS** |
| `audio.play` / `audio.src` outside `AudioContext` | None in preview chain | Only `AudioContext` + page **video** `.play()` | **PASS** |
| Preview uses `useImmersivePlayback` | Yes | `PreviewModalPlayer`, `PreviewPlayerControls` | **PASS** |

### D.2 Build / lint

| Check | Result | Status |
|-------|--------|--------|
| `npm run build` | Exit **0** | **PASS** |
| `npm run lint` (repo-wide) | Exit **1** — 1 error, 78 warnings | **PARTIAL** |
| `ImmersivePreviewModal` `rules-of-hooks` | **No current error** (pre-`37dac20` audit at L95 obsolete) | **PASS** |
| Lint error source | Parse error in `docs/reports/snapshot/.../AuthScreenCard.js` (artifact) | **WARN** — exclude snapshot from lint |

### D.3 Polish-pass layer checklist (from `703e966` implementation)

| Layer | Status |
|-------|--------|
| 1. Render stability | **done** (committed) |
| 2. Modal stability | **done** |
| 3. Audio polish | **done** |
| 4. Animation continuity | **done** |
| 5. State cleanliness | **done** |

### D.4 Manual tests (Section B)

All items **B1–B25**: **TBD** — require human pass on desktop + mobile.

### D.5 Known non-P0 follow-ups (document only)

| Item | Severity | Note |
|------|----------|------|
| Inline helpers still in `page.js` (`CarouselUI`, `FeaturesRail`, `Grid`, `AmbientPlaybackBackground`) | P2 | Out of final-mile scope; not regressions |
| `ModalAudioPlayer.js` orphan | P2 | No imports in `src/` |
| `shareable/component-exports` drift | P2 | Recovery copies ≠ live tree |
| Repo-wide lint warnings (`set-state-in-effect`, `no-img-element`) | P3 | Pre-existing noise |

### D.6 P0 regression scan

**No P0 regression found** in automated checks. Hooks order and single-audio invariant match post-fix targets. Manual QA still required for perceived quality (Section B).

---

## Commands used (this report)

```bash
grep -R "<audio" src
grep "previewModalOpen\|immersive-preview-modal\|modalAudioRef" src/app/page.js
grep "FlowState\|LivePanel\|RadioCarousel" src/app/page.js
grep "useCoverPalette" src/components/preview/ImmersivePreviewModal.js
git rev-parse HEAD
git log --oneline 37dac20 fb1f164 703e966
npm run lint
npm run build
```

---

## Related artifacts

- `docs/reports/remove-architectural-chaos-audit.md` — pre-fix dual-audio audit (2026-05-24)
- `docs/reports/immersive-player-forensic-audit.md` — player/modal inventory
- Commit `703e966` — polish pass implementation summary in git history
