# V9 Immersive Modal Replacement — 2026-05-27

## Deleted

- `src/components/modal/ModalShell.js`
- `src/components/preview/immersive/` (entire folder, 15 modules):
  - AmbientArtworkBackground.js, AmbientLightingLayer.js, AtmosphericBackgroundLayer.js
  - FloatingArtworkHero.js, FloatingViewMore.js
  - ImmersiveModalAccessBadge.js, ImmersiveModalChrome.js, ImmersiveModalEnvironment.js
  - ImmersiveModalPanel.js, ImmersiveModalScene.js, ImmersiveModalStage.js
  - ModalActionButtons.js, PreviewPlayerControls.js, TrackMeta.js
  - constants.js, index.js

## Installed / wired

- **`src/components/preview/ImmersivePreviewModal.js`** — single-file V9 implementation:
  - Stripped: demo `App()`, mock SINGLES/ALBUMS/PLAYLISTS, inline `CSS`/`FONTS`, `THEMES`
  - `useMediaEngine()` for `isPlaying`, `toggle`, `seek`, engine time/duration (no mount auto-play)
  - `useCoverPalette(cover)` → `buildTheme()` for scene/orbs/controls (no theme catalog)
  - `Scene` uses real cover from `catalogCoverDisplay` / track cover fields
  - Default export wrapper: `single`, `access`, `onClose` (+ legacy `trackAccess` fallback)
  - Named export: `AlbumModal` (available for future album wiring)
  - Modal stack: `registerModal` + `usePlayerBodyState`

- **`src/app/page.js`**
  - `access={resolveTrackAccess(..., accountState)?.canStream ? "full" : "preview"}`
  - `resolveTrackAccess` import from `@/lib/music-access`

- **`ModalPlayerShell.js`** — inlined former `ModalShell` so deprecated engine export still resolves after shell delete

## globals.css

- V9 modal utility CSS and keyframes (`oa`, `ob`, `oc`, `ray`, `scan`, `al-glow`, `eq-sc`, `cp`, `cg`, `sh-up`) were **already present** at end of `globals.css` (lines ~4202–4286).
- **No duplicate keyframes** found elsewhere in the file — `mm-` prefix not required for this pass.
- Reduced-motion overrides for `.sc-orb`, `.sc-scan`, `.cart-pulse`, `.eq-b` already scoped.

## Build

- `npm run build` — **PASS** (Next.js 16.2.4)

## Commit

- `feat(modal): complete V9 replacement`
