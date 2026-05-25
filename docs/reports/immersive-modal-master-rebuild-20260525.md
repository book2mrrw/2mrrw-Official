# Immersive Modal Master Rebuild — 2026-05-25

Extends [immersive-modal-forensic-fix-20260525.md](./immersive-modal-forensic-fix-20260525.md) without reverting: single viewport tree, one video decode, global `AudioContext` only.

## Target structure (implemented)

```
ModalShell (z 8888, modalStackStore: immersive-preview)
└── PlayerAtmosphere (fixed vignette — outside stage transform trap)
└── modal-immersive-body
    └── ImmersiveModalEnvironment
        ├── ImmersiveModalChrome (mobile only)
        ├── ImmersiveModalStage
        │   ├── AtmosphericBackgroundLayer → AmbientArtworkBackground (palette/static blur, no MP4)
        │   ├── AmbientLightingLayer (CSS palette glow)
        │   ├── FloatingArtworkHero → immersive-mp4-world → CoverArt (ONE video/img)
        │   ├── ViewMoreExpansion (Framer spring drawer)
        │   └── GlyphLyricsPanel
        └── ImmersiveModalPanel
            ├── TrackMeta (MetadataLayer)
            ├── PreviewPlayerControls (PlaybackControls + volume + stream hint)
            └── ModalActionButtons (SecondaryActions)
```

**SharedGlobalAudioLayer:** `page.js` calls `playTrack(toPlaybackTrack(...))` on open; UI subscribes via `useMediaEngine` / `useImmersivePlayback`. No `<audio>` in modal.

## Root causes (carried + addressed)

1. Dual DOM trees — **fixed** (forensic); preserved via `ImmersiveModalEnvironment` single branch.
2. Duplicate MP4 in ambient — **fixed** (forensic); motion ambient is palette + pulse only.
3. Transform stacking trapping atmosphere / empty chrome — **PlayerAtmosphere** remains direct child of `modal-immersive-body`, not inside `modal-immersive-stage`.
4. Split player UIs — **unified** `PreviewPlayerControls` with `layoutId={undefined}` on play ring.
5. Weak preview affordance — scrub display caps at 30s when `!canStream`; stream hint in controls.

## Files changed

| File | Role |
|------|------|
| `src/components/preview/ImmersivePreviewModal.js` | Orchestrator → `ImmersiveModalEnvironment` |
| `src/components/preview/immersive/ImmersiveModalEnvironment.js` | Content gate + mobile/desktop motion wrappers |
| `src/components/preview/immersive/ImmersiveModalStage.js` | Stage layer composer |
| `src/components/preview/immersive/ImmersiveModalPanel.js` | Panel layer composer |
| `src/components/preview/immersive/ImmersiveModalChrome.js` | Mobile sheet handle + close |
| `src/components/preview/immersive/AtmosphericBackgroundLayer.js` | Atmosphere stack (no vignette) |
| `src/components/preview/immersive/AmbientLightingLayer.js` | Palette-derived CSS lighting |
| `src/components/preview/immersive/FloatingArtworkHero.js` | Single hero surface |
| `src/components/preview/immersive/constants.js` | Springs, preview cap constant |
| `src/components/preview/immersive/index.js` | Barrel exports |
| `src/components/preview/immersive/AmbientArtworkBackground.js` | Pulse for motion covers |
| `src/components/preview/immersive/PreviewPlayerControls.js` | Preview hint, 30s display cap, no layoutId |
| `src/components/preview/immersive/FloatingViewMore.js` | Shared drawer spring constant |
| `src/app/globals.css` | Layer z-index, mp4-world GPU, safe-area fill, stream hint |

## Entitlement / preview verification

| Access | Source | Modal UI | Audio src |
|--------|--------|----------|-----------|
| Non-owner | `resolveTrackAccess` → `previewOnly` | `PREVIEW TRACK` + `Preview · 30s` | `resolvePlaybackSrc` → preview CDN path |
| Purchased / owned | `canStream` | `FULL STREAM` | signed/full stream via playback API |
| Subscriber / collector | `canStream` per account state | badge + full stream | same |

Playback initiation unchanged: `page.js` effect on `previewModalOpen` + `previewPlaybackSlug` → `toPlaybackTrack(selectedSingle, accountState, "preview_modal")`.

Queue/shuffle: not invoked from preview modal; global `GlobalAudioPlayerBar` unchanged.

## Build status

Run: `npm run build` — must pass before commit.

## Remaining gaps

- Other modals/sheets not on `modalStackStore` (unchanged).
- `PreviewModalPlayer.js` — deprecated orphan.
- Client does not hard-stop at 30s if preview file is longer; relies on preview asset + UI cap (server clip is source of truth).

## Manual QA checklist (mobile Safari)

- [ ] Open single preview: one cover/video, no stacked duplicate artwork
- [ ] Preview track (logged out): label shows preview, audio plays preview URL, scrub respects ~30s display
- [ ] Owned/subscriber: full stream label and uninterrupted playback
- [ ] Play/pause, scrub, volume — all respond; no second audio element in DOM
- [ ] View More: spring drawer up, drag down to collapse
- [ ] GLYPHS panel overlays stage; panel dims appropriately
- [ ] Close via handle, ✕, overlay tap
- [ ] No white bar in safe-area notch region
- [ ] Expanded global player still works; no layoutId flicker from modal art
