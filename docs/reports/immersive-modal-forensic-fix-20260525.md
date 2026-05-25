# Immersive Modal Forensic Fix — 2026-05-25

**Scope:** `ImmersivePreviewModal` render architecture only (no entitlements, page.js, or dependency changes).

## Root causes (numbered)

1. **Dual mobile + desktop trees mounted simultaneously** — Both branches used `LAYER_HIDDEN` (`position: absolute; inset: 0`) while staying in the DOM. Inactive branch still decoded **video** cover art in ambient + foreground layers, producing vertical duplication and reflection-like blur stacks.
2. **Second video surface in `AmbientArtworkBackground`** — Motion/video covers rendered a full `CoverArt` inside `modal-immersive-ambient__blur--motion` while `modal-immersive-art` rendered the same source again (only surface should decode media).
3. **Split player UI implementations** — Mobile used `PreviewPlayerControls` (AudioContext via `useMediaEngine`); desktop used legacy `PreviewModalPlayer` (inline styles, no volume, different layout).
4. **`PlayerAtmosphere` outside `ModalShell`** — Atmosphere vignette was a fragment sibling, not part of the shell content stack; combined with duplicate layers, users saw dim/atmosphere without a clear control column.
5. **Skeleton + content overlap** — `ImmersiveModalSkeleton` rendered as a sibling while full layers mounted underneath during `contentReady` RAF, contributing to flash and perceived empty chrome (safe-area + atmosphere).

## Files changed

| File | Change |
|------|--------|
| `src/components/preview/ImmersivePreviewModal.js` | Single branch per viewport; ModalShell hierarchy; one stage + panel; unified `TrackMeta` + `PreviewPlayerControls`; atmosphere inside shell |
| `src/components/preview/immersive/AmbientArtworkBackground.js` | Removed motion/video `CoverArt` from ambient (palette + static blur only) |
| `src/components/preview/immersive/PreviewPlayerControls.js` | Volume slider via `useMediaEngine.setVolume` |
| `src/app/globals.css` | `.modal-immersive-body`, volume control styles |

## Restored behavior

- Title, artist/status, access badge, library button (`TrackMeta`) on mobile and desktop
- Play/pause, progress scrub, time labels (`PreviewPlayerControls` + global audio engine)
- Volume control (modal panel)
- View More credits drawer (`FloatingViewMore`)
- Preview vs full stream labels from `trackAccess` (unchanged entitlement path)
- Cart / gift / vinyl actions (`ModalActionButtons`)
- Single artwork surface in `modal-immersive-art` with non-duplicating ambient wash

## Build status

`npm run build` — **pass** (Next.js 16.2.4).

## Remaining gaps

- **Album modal, nav/cart sheets, DonateModal, AuthGate, subscribe Stripe sheet** — not on `modalStackStore` (documented Phase 8 deferral).
- **`PreviewModalPlayer.js`** — unused by immersive modal now; kept for reference; safe to delete in a cleanup pass.
- **Expanded `GlobalAudioPlayerBar`** — separate immersive surface; uses `PLAYER_LAYOUT_ID` on dock artwork only (preview modal does not use `layoutId` on cover).

## Architecture after fix

```
ModalShell (stackId: immersive-preview)
└── modal-immersive-body
    ├── PlayerAtmosphere (BackgroundAtmosphere)
    ├── [mobile chrome: handle, close]
    ├── modal-immersive-stage
    │   ├── AmbientArtworkBackground (no duplicate media)
    │   ├── modal-immersive-art → CoverArt (ONE surface)
    │   ├── FloatingViewMore
    │   └── GlyphLyricsPanel
    └── modal-immersive-panel
        ├── TrackMeta
        ├── PreviewPlayerControls (+ volume)
        └── ModalActionButtons
```

Audio: `page.js` → `playTrack` on open; UI → `useMediaEngine` / `AudioContext` only (no modal-local `<audio>`).

**Follow-up:** [immersive-modal-master-rebuild-20260525.md](./immersive-modal-master-rebuild-20260525.md) — extracted layer components and z-index stack.
