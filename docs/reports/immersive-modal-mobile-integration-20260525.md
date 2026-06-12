# Immersive Modal Mobile Integration — 2026-05-25

Prototype source: `~/Downloads/immersive-modals-v8.tsx` (mobile single modal patterns). Integrated into existing `ImmersivePreviewModal` tree only — no parallel modal system.

## Build

`npm run build` — **pass** (Next.js 16.2.4).

## Component tree

### Before

```
ModalShell
└── PlayerAtmosphere
└── modal-immersive-body
    └── ImmersiveModalEnvironment
        ├── ImmersiveModalChrome (handle + ✕ right)
        ├── ImmersiveModalStage
        │   ├── AtmosphericBackgroundLayer → AmbientArtworkBackground
        │   ├── AmbientLightingLayer
        │   ├── FloatingArtworkHero
        │   ├── FloatingViewMore
        │   └── GlyphLyricsPanel
        └── ImmersiveModalPanel
            ├── TrackMeta
            ├── PreviewPlayerControls  ← panel only (mobile + desktop)
            ├── PreviewEndedCTA (inline / event-driven)
            └── ModalActionButtons (card row)
```

### After

```
ModalShell
└── PlayerAtmosphere
└── modal-immersive-body [--mobile]
    └── ImmersiveModalEnvironment (+ trackAccess, palette)
        ├── ImmersiveModalChrome
        │   ├── sheet handle (drag dismiss via ModalShell)
        │   ├── ✕ close (leading, art zone)
        │   └── ImmersiveModalAccessBadge (PREVIEW / OWNED / entitlement badge)
        ├── ImmersiveModalStage [--mobile 62%]
        │   ├── ImmersiveModalScene (orbs, rays, scan, grain — palette CSS vars)
        │   ├── AtmosphericBackgroundLayer → AmbientArtworkBackground
        │   ├── AmbientLightingLayer
        │   ├── FloatingArtworkHero [--mobile offset above float player]
        │   ├── modal-immersive-float-player (mobile only)
        │   │   └── PreviewPlayerControls variant=floating → useMediaEngine + AudioContext
        │   ├── FloatingViewMore (sheet styling)
        │   └── GlyphLyricsPanel
        └── ImmersiveModalPanel [--mobile 38%]
            ├── TrackMeta (centered mobile head; badge on chrome)
            ├── PreviewPlayerControls (desktop / non-mobile panel only)
            ├── PreviewEndedCTA (from ImmersivePreviewModal + AudioContext previewEnded)
            └── ModalActionButtons (mobile icon row: cart, subscribe, gift)
```

## Files changed

| File | One-line summary |
|------|------------------|
| `src/hooks/useCoverPalette.js` | Added `--p1`, `--p2`, `--accent`, `--glow`, `--glow-dim` aliases on palette CSS vars (cover-derived, not theme catalog). |
| `src/app/globals.css` | Mobile 62/38 split, scene/float-player/badge/act-row/drawer scoped under `.modal-immersive-*`. |
| `src/components/preview/ImmersivePreviewModal.js` | Passes `canStream`/`previewOnly` to stage; chrome env props; `modal-immersive-body--mobile`. |
| `src/components/preview/immersive/ImmersiveModalEnvironment.js` | Wires `trackAccess`, `canStream`, `palette` to mobile chrome. |
| `src/components/preview/immersive/ImmersiveModalChrome.js` | Leading close + `ImmersiveModalAccessBadge`. |
| `src/components/preview/immersive/ImmersiveModalStage.js` | Scene layer + mobile floating `PreviewPlayerControls`. |
| `src/components/preview/immersive/ImmersiveModalPanel.js` | Mobile panel layout; player only on desktop panel. |
| `src/components/preview/immersive/PreviewPlayerControls.js` | `variant=floating` with CSS waveform driven by `isPlaying` (no mock timers). |
| `src/components/preview/immersive/TrackMeta.js` | Centered mobile title/artist/sub; hide duplicate badge when chrome shows it. |
| `src/components/preview/immersive/ModalActionButtons.js` | Mobile icon row (cart, `/subscribe`, gift) vs desktop cards. |
| `src/components/preview/immersive/FloatingArtworkHero.js` | Mobile art position above float player. |
| `src/components/preview/immersive/index.js` | Export scene + access badge. |
| `src/components/preview/immersive/ImmersiveModalScene.js` | **NEW** — CSS-only orbs/rays/grain inside stage. |
| `src/components/preview/immersive/ImmersiveModalAccessBadge.js` | **NEW** — PREVIEW vs OWNED / entitlement label. |
| `src/components/music/MusicAccessBadge.js` | `canStream` tint for badge color (adjacent entitlement UX). |

## AudioContext wiring

- Playback unchanged: `page.js` opens modal → `playTrack(toPlaybackTrack(...))` on global `AudioContext`.
- `PreviewPlayerControls` uses `useMediaEngine()` for `isPlaying`, `currentTime`, `duration`, `seek`, `toggle`, `setVolume`.
- Buffering/errors via `useAudioPlayer()` (`retryStreamPlayback`).
- Preview cap: `PREVIEW_DISPLAY_CAP_SEC` (30) for scrub display when `previewOnly`; hard stop remains in `AudioContext`.
- `PreviewEndedCTA` stays parent-driven from `previewEnded` in `ImmersivePreviewModal` (no `setInterval` mock progress).

## What was NOT ported (and why)

| Prototype item | Reason |
|----------------|--------|
| Standalone `App.js` / demo stage cards | Out of scope; site already has catalog entry. |
| `THEMES` catalog (`dissolution`, `origin`, …) | Guardrail: derive from `useCoverPalette` → CSS vars only. |
| `setInterval` / mock progress & beat timers | Replaced with `useMediaEngine` + CSS animation on `isPlaying`. |
| Google Fonts (`Outfit`, `Cormorant`, `DM Mono`) | Site font stack preserved; no global font import. |
| Unsplash / placeholder art | Hero uses `CoverArt` + track `cover`/`video`. |
| Parallel `SingleModal` / `AlbumModal` trees | Enhanced existing `ImmersivePreviewModal` only. |
| Album modal prototype (`AlbumModal`, tracklist, mini player, playlist sheet) | Album UX remains `AlbumTracklistSheet` + legacy album overlay in `page.js` — separate stack, not `ImmersivePreviewModal`. |
| Shuffle / prev / next in float player | Not in current preview modal contract; global bar handles queue. |
| Prototype share sheet / playlist sheet | No production handlers; `MusicPlusButton` + gift remain. |
| Homepage, nav, `layout.js`, `GlobalAudioPlayerBar`, AV section | Explicit hard rule — untouched. |

## Album tracklist note

`AlbumTracklistSheet` already uses `AudioContext` (`playQueue`, `toggle`). Visual parity with prototype album modal was not merged into that sheet in this pass (modal-only scope). Future work could reuse `.modal-immersive-*` track row classes there.

## Manual QA (mobile)

- [ ] Open single preview: 62% art / 38% info, scene orbs visible, one cover decode
- [ ] PREVIEW badge + 30s scrub cap for visitors
- [ ] OWNED / FULL STREAM badge when entitled
- [ ] Play/pause/scrub in float player; no second `<audio>` in modal
- [ ] Cart + Subscribe icons fire existing cart / `/subscribe`
- [ ] View More drawer drag + handle styling
- [ ] Drag pill / overlay dismiss still closes modal
