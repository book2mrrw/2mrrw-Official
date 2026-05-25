# Immersive player forensic audit (read-only)

**Date:** 2026-05-24  
**Workspace:** `/Users/recharge/artist-platform`  
**Scope:** Player, preview modal, audio context, motion/blur/z-index, build/lint. No code changes.

---

## Executive summary

The immersive experience is split across **two audio surfaces**: global playback (`AudioContext` + `GlobalAudioPlayerBar` + `ImmersivePlayerEngine`) and **home preview modal** playback (`page.js` `modalAudioRef` + `ImmersivePreviewModal`). Artwork and palette logic are centralized in `media-session-artwork`, `music-playback`, and `useCoverPalette`, but **shareable/component-exports** copies diverge from `src`. **Production build passes**; **lint fails** (2 errors, 83 warnings), including a **rules-of-hooks error** in `ImmersivePreviewModal`. `ModalAudioPlayer` appears **unused**. Heavy blur/motion live in `globals.css` (`.modal-immersive-*`) and hero `page.js` (z-index up to 6500 inline vs 7590–9500 in CSS).

---

## 1. File inventory (`find` — pruned `node_modules`, `.git`, `.next`)

| Path | Role |
|------|------|
| `src/context/AudioContext.js` | Single `<audio>` ref, Media Session, queue, CS mode (~1361 LOC) |
| `src/components/audio/GlobalAudioPlayerBar.js` | Layout shell; dock + floating engine (~570 LOC, 8× `useEffect`) |
| `src/components/player/ImmersivePlayerEngine/*` | Modal shell, artwork `layoutId`, atmosphere, dock/floating UI |
| `src/components/preview/ImmersivePreviewModal.js` | Storefront single preview modal (~393 LOC) |
| `src/components/preview/PreviewModalPlayer.js` | Progress/time UI bound to passed `audioRef` |
| `src/components/preview/immersive/*` | Ambient bg, controls, actions, meta, FloatingViewMore |
| `src/components/media/ModalAudioPlayer.js` | Alternate modal player using `useAudioPlayer()` — **no imports in `src/`** |
| `src/lib/player/*` | `PLAYER_LAYOUT_ID`, body state, ambience, `useImmersivePlayback` |
| `src/lib/media-session-artwork.js` | Lock-screen artwork sizes + cache |
| `src/hooks/useCoverPalette.js` | Dominant-color palette for modal/player accent |
| `src/app/globals.css` | `.modal-immersive-*`, `.player-*`, z-index ladder |
| `src/app/layout.js` | Mounts `GlobalAudioPlayerBar` globally |
| `src/app/page.js` | `ImmersivePreviewModal`, hidden `modalAudioRef` `<audio>`, hero blur/motion |
| `shareable/component-exports/*` | Exported copies (differ from `src`) |
| `public/audio/`, `audio/` | Static audio assets |
| `docs/reports/*media*` | Prior media-session upgrade notes |

---

## 2. Duplication and drift risks

### 2.1 Dual playback paths

| Surface | Audio element | Control API |
|---------|---------------|-------------|
| Global bar / library / albums | `AudioContext` `audioRef` | `useAudioPlayer()` |
| Home immersive preview modal | `page.js` `modalAudioRef` | Direct DOM on ref; `PreviewModalPlayer` / `PreviewPlayerControls` |

**Risk:** Two players can overlap (modal preview vs global track), divergent Media Session behavior, and duplicated time/progress listeners (`PreviewModalPlayer` vs `AudioContext`).

### 2.2 Artwork field normalization (many aliases)

Grep hits across `coverArt`, `cover`, `cover_art_url`, `thumbnail`, `poster`, `artwork` in:

- `AudioContext.js`, `music-playback.js`, `control-system/releases.js`, `account.js`, `vault.js`
- `page.js`, `MyMusicTab.js`, collector cards, gifts, playlists

**Risk:** Inconsistent cover type (`coverArtType`) between modal path and global path if catalog shape differs.

### 2.3 Modals and shells

| Component | Pattern |
|-----------|---------|
| `ImmersivePreviewModal` | `ModalPlayerShell` + `PlayerAtmosphere` (shared engine) |
| `DonateModal`, `GiftBottomSheet`, `CollectorCardModal` | Separate framer-motion overlays |
| `page.js` `exclusiveModal` | Inline fixed overlay (z-index 8888), not shared shell |
| `ModalAudioPlayer` | Orphan — uses global `useAudioPlayer()` but never imported |

### 2.4 Shareable exports vs `src`

`diff` shows **ImmersivePreviewModal** and **PreviewModalPlayer** under `shareable/component-exports/` **differ** from `src/components/preview/`. Stale exports risk wrong recovery/restores.

### 2.5 `layoutId` / shared element transition

- `PLAYER_LAYOUT_ID = "immersive-player-artwork"` in `src/lib/player/constants.js`
- Used in `PlayerArtwork`, `FloatingMainPlayer`, `SignaturePlayRing`
- `GlobalAudioPlayerBar.js` passes **`layoutId={undefined}`** on one artwork path (line ~516)

**Risk:** Dock ↔ expanded hero artwork morph may be intentionally disabled or accidentally broken.

---

## 3. Blur, filters, blend modes

### 3.1 Immersive modal (`globals.css`)

- `.modal-immersive-ambient__blur`: `filter: blur(28px) saturate(1.35) brightness(0.42)`, `scale(1.12)`, pulse animation
- Motion cover variant: `blur(32px)` on `.modal-immersive-ambient__media`
- `mix-blend-mode: screen` on pulse and `::after` gradients
- Action cards: `backdrop-filter: blur(8px)`
- Overlay: `z-index: 8888` (`.modal-immersive-overlay`)

### 3.2 Hero / storefront (`page.js`)

- Inline `blur(120px)`, `blur(72px)`, `blur(32px)` on hero imagery
- Mobile dock area `zIndex: 6500` (inline) — **below** modal overlay 8888 but competes with player CSS ladder

### 3.3 Components

- `GlyphLyricsPanel.js`: inline `backdropFilter: blur(6px)`, `zIndex: 6`
- `CollectorCardModal.js`: blur(12px) backdrop
- `CoverArtCS.js`: saturate/brightness filters

**Risk:** Stacking multiple full-screen blurs (hero + modal ambient + floating player) is GPU-heavy on mobile; `will-change` used on ambient layers.

---

## 4. Z-index findings

- **No** Tailwind arbitrary `z-[...]` matches under `src` (grep empty).
- **Modal immersive:** overlay 8888; internal layers 0–9; close 24
- **Player globals:** 7590, 7700, 8500, 8870, 9000, 9200, 9500, **99990** (glyph/sheet tier)
- **GlobalAudioPlayerBar:** inline `zIndex: 7600` on one wrapper
- **page.js:** cart/sidebar/modals 8888, membership 9998, mobile chrome 6500

**Risk:** Hero inline 6500 vs CSS 7590+ player bar — ordering depends on DOM placement (layout mounts bar after page content).

---

## 5. Motion (framer-motion)

### Player / preview stack

- `ModalPlayerShell`: `OVERLAY_FADE`, sheet vs desktop motion props
- `PlayerArtwork`, `SignaturePlayRing`: `motion.div` / `motion.button` + **`layoutId`**
- `ImmersivePreviewModal`: `motion.div` for art drawer sections
- `FloatingViewMore`, `GlyphLyricsPanel`: `AnimatePresence`
- `GlobalAudioPlayerBar` / controls: `PlayerControlButton`, `CSModeButton` — motion buttons
- **`layoutId={undefined}`** in `GlobalAudioPlayerBar` (see §2.5)

### Broader codebase

- `page.js` is the largest motion surface (album sheet, cart, checkout, nav) — separate from immersive engine but same z-index band as modals.

---

## 6. `useEffect` density (scoped grep)

| Location | Count |
|----------|------:|
| **Total** `player` + `audio` + `preview` + `AudioContext.js` | **26** |
| `GlobalAudioPlayerBar.js` | 8 |
| `AudioContext.js` | 7 |
| `GlyphLyricsPanel.js` | 3 |
| `PreviewModalPlayer.js`, `PreviewPlayerControls.js`, control buttons | 2 each |

**Note:** `ImmersivePlayerEngine` leaf files use hooks via parents; no `useEffect` in engine folder itself from this grep.

**Risk:** `GlobalAudioPlayerBar` effect + setState pattern flagged by ESLint `react-hooks/set-state-in-effect` (line 106).

---

## 7. Audio APIs

- **Primary:** `new Audio()` preload in `AudioContext`; main element via `audioRef`
- **No Howl** in `src`
- **Hooks:** `useAudioPlayer()` widely; `useAudioVisuals` is media catalog (not playback)
- **Modal preview:** `audioRef` prop threading — **not** `AudioContext`
- **page.js:** additional ambient `new Audio(src)` loop instances for atmosphere
- **Vault:** `AudioContext` class in `vault-audio.js` (separate from React context)

---

## 8. Tailwind utility classes (`opacity-`, `scale-`, etc.)

Grep under `src/components/player`, `preview`, `audio` returned **no matches** — styling is overwhelmingly **CSS modules/classes in `globals.css`** and inline styles in preview/hero.

---

## 9. Build results (`npm run build`)

| Result | Detail |
|--------|--------|
| **Status** | **PASS** — compiled successfully (Next.js 16.2.4, Turbopack) |
| **TypeScript** | Ran as part of build (~317ms), no failure reported |
| **Warnings** | Multiple routes: `themeColor` in metadata should move to `viewport` export (`/`, `/join`, `/subscribe`, `/success`, `/verify-otp`, collectors-cards, etc.) |
| **npm** | `Unknown env config "devdir"` (environment config, not app code) |

**`npm run type-check`:** **N/A** — no script in `package.json` (TS checked via `next build` only).

**Dev server:** Not started (per audit instructions). Runtime console / Media Session on device requires manual check.

---

## 10. Lint results (`npm run lint` → `eslint .`)

| Metric | Value |
|--------|------:|
| Problems | **85** (2 errors, 83 warnings) |

### Errors (player-relevant)

1. **`src/components/preview/ImmersivePreviewModal.js:95`** — `useCoverPalette` called **conditionally** (`react-hooks/rules-of-hooks`). **Ship-blocker class bug** for strict CI.
2. **`docs/reports/snapshot/d3ea6f4/src_components_auth_AuthScreenCard.js`** — parsing error (snapshot artifact in repo; pollutes lint).

### Warnings (player-relevant)

- **`GlobalAudioPlayerBar.js:106`** — `setState` in effect (`react-hooks/set-state-in-effect`)
- **`useCoverPalette.js`** — same rule (feeds modal accent; affects immersive palette)

### Lint scope note

Most warnings are app-wide (auth, gifts, sync hooks). Immersive stack is a **small fraction** but includes the **conditional hook error**.

---

## 11. Prioritized recommendations (no code changes)

| P | Item | Action |
|---|------|--------|
| **P0** | Fix conditional `useCoverPalette` in `ImmersivePreviewModal` | Move hook above early returns; align with React rules |
| **P0** | Resolve dual audio: `modalAudioRef` vs `AudioContext` | Design: preview uses global player, or hard-pause global when modal opens |
| **P1** | Remove or wire `ModalAudioPlayer` | Delete dead code or replace duplicate modal UI |
| **P1** | Sync or delete stale `shareable/component-exports` | Single source of truth under `src/` |
| **P1** | Re-enable or document `layoutId={undefined}` in `GlobalAudioPlayerBar` | Restore morph or remove unused `PLAYER_LAYOUT_ID` paths |
| **P2** | ESLint exclude `docs/reports/snapshot/**` | Stop snapshot files from failing lint |
| **P2** | Z-index audit diagram | Map 6500 (page inline) vs 7590–9500 (player) vs 8888 (modal) vs 99990 (glyph) |
| **P2** | Mobile GPU: ambient blur layers | Test with reduced motion; consider static blur fallback |
| **P3** | Migrate `themeColor` to `viewport` exports | Clear Next 16 warnings |
| **P3** | Artwork normalization helper | Single function for cover + `coverArtType` used by modal and library |

---

## 12. Commands run (reference)

```bash
find . \( -path ./node_modules -o -path ./.git -o -path ./.next \) -prune -o \
  \( -iname "*player*" -o -iname "*modal*" -o -iname "*audio*" -o -iname "*immersive*" -o -iname "*media*" \) -print

grep -R "coverArt|artwork|..." src --include="*.js" ...
grep -R "backdrop-filter|mix-blend-mode|filter:|blur(" src ...
grep -R "AnimatePresence|motion.|layoutId|framer-motion" src ...
grep -R "createPortal|Portal|Modal" src ...
grep -R "useEffect" src/components/player src/components/audio src/components/preview src/context/AudioContext.js
grep -R "z-\[" src; grep zIndex src/components/player ...
grep -R "audioRef|useAudio|Howl|new Audio" src ...
npm run build
npm run lint
```

---

*End of report.*
