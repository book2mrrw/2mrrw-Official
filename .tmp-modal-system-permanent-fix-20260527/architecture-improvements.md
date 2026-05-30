# Architecture improvements

1. **Single modal stack per surface** — `openAlbumModal`, `openSingleModal`, and `openFeatureModal` each dismiss the other immersive modals before opening, preventing double overlays and conflicting `modalStackStore` registrations.

2. **Shared dismiss helper** — `dismissPreviewAndFeatureModals()` centralizes preview + feature teardown for album open path.

3. **Album playback contract** — `AlbumModal` accepts `onPlayTrackAtIndex` from page (owns `playAlbumTracks` + entitlements). Modal UI stays presentational; queue authority stays in `AudioContext` via existing `albumTracksForPlayback`.

4. **Consistent exit wrapper** — Album modal wrapped in `AnimatePresence` like singles/features for aligned mount/unmount with framer-motion shell.

5. **Error boundary retained, throws removed** — `ModalErrorBoundary` remains for unexpected failures; primary user-facing "Try again" path for catalog modals eliminated by fixing render-time TypeError.

6. **Account tab** — Display derived fields (`accountDisplayName`, `accountDisplayInitial`) remain the source of truth; no inline `name[0]` access.
