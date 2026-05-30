# Modals inventory

All paths relative to repo root `src/`.

## Primary music modals

| Path | Role | Key exports | Open / close | Playback / entitlement |
|------|------|-------------|--------------|------------------------|
| `components/preview/ImmersivePreviewModal.js` | Immersive single **and** feature preview; mobile `MobileV9Layout` + desktop `ImmersiveModalEnvironment` | `default` memo | **Open:** parent sets state; **Close:** `onClose` → `closeSingleModal` / `closeFeatureModal` (pauses) | `useAudioPlayer` + `useMediaEngine`; `trackAccess` prop; `previewOnly` from `!trackAccess.canStream` (~856–857); `FloatingPlayer` / `PreviewPlayerControls` (~607–616, desktop stage) |
| `components/modal/ModalShell.js` | Shared framer-motion overlay + sheet/center shell; body scroll via `modalStackStore` | `default` memo | `registerModal(stackId)` on mount (~48–52); overlay `onOverlayClick`; mobile drag dismiss | No audio; children only |
| `components/preview/immersive/ImmersiveModalEnvironment.js` | Desktop layout: stage + panel columns | `default` memo | N/A (child of ImmersivePreviewModal) | Delegates to `ImmersiveModalStage` / `ImmersiveModalPanel` |
| `components/preview/immersive/ImmersiveModalStage.js` | Art zone: scene, cover hero, floating `PreviewPlayerControls` | named export | N/A | `useMediaEngine` analyser/time (~34–37); `PreviewPlayerControls` (~73–79) |
| `components/preview/immersive/ImmersiveModalPanel.js` | Info column: meta, `PreviewPlayerControls`, cart actions | named export | N/A | `previewOnly` from `trackAccess` (~37); `PreviewPlayerControls` |
| `components/preview/immersive/ImmersiveModalScene.js` | Visualizer / atmosphere tied to analyser | default | N/A | `analyser`, `playbackState`, `previewOnly` |
| `components/preview/immersive/ImmersiveModalChrome.js` | Mobile top chrome + close | default | `onCloseClick` | Badge only |
| `components/preview/immersive/ImmersiveModalAccessBadge.js` | Access tier badge on art | default | N/A | `trackAccess`, `canStream` |
| `components/preview/immersive/PreviewPlayerControls.js` | Waveform/scrub/play; CS/space/bass | default | N/A | `useMediaEngine` seek/toggle (~160–170); preview cap `PREVIEW_DISPLAY_CAP_SEC` (~197–201) |
| `components/preview/immersive/ModalActionButtons.js` | Cart / vinyl / gift actions | default | N/A | Uses parent callbacks |
| `components/music/AlbumTracklistSheet.js` | Bottom sheet: album track list, play all/shuffle | `default` | `open` prop; `registerModal("album-tracklist-sheet")` (~48–51); drag dismiss (~82–94) | `playQueue` / `toggle` (~31, 54–67); `resolveTrackAccess` per row (~242–245) |

## page.js inline modals (not separate components)

| Location | Purpose | Open state | Close | Playback |
|----------|---------|------------|-------|----------|
| `app/page.js` ~538–544 | Single preview | `previewModalOpen`, `selectedSingle` | `closeSingleModal` (~1172–1177) pauses | `openSingleModal` plays (~1101–1111) |
| `app/page.js` ~540–541 | Feature (reuses ImmersivePreviewModal) | `featureModalOpen`, `featureModalItem` | `closeFeatureModal` (~1148–1153) pauses | `openFeatureModal` (~1130–1140) |
| `app/page.js` ~544, 1577–1676 | Album modal | `selectedAlbum` truthy | `closeAlbumModal` (~1180–1182) pauses | `openAlbumModal` → `playAlbumTracks` (~1156–1162); per-track buttons (~1627–1671) |
| `app/page.js` ~1699+ | Event detail overlay | `selectedEvent` | set null | Cart only |
| `app/page.js` ~1714+ | Exclusive item modal | `exclusiveModal` | set null | Cart only |
| `app/page.js` ~2821+ | Stripe checkout | `clientSecret` | clear secret | N/A |
| `app/page.js` ~2750+ | Membership upsell | `membershipUpsellOpen` | set false | N/A |
| `app/page.js` blog/inner circle | Content overlays | `blogPost`, `innerCirclePost` | set null | N/A |

## Other *Modal* files

| Path | Role | Notes |
|------|------|-------|
| `components/payments/DonateModal.js` | Donation flow + Stripe | `registerModal`; no playback |
| `components/collectors-cards/CollectorCardModal.js` | Collector card purchase | Stripe; `useAuth` |
| `components/player/ImmersivePlayerEngine/ModalPlayerShell.js` | **Deprecated** re-export of `ModalShell` | |
| `components/media/_deprecated/ModalAudioPlayer.js` | **Deprecated** unused | Comment: use AudioContext |
| `ui/skeletons/ImmersiveModalSkeleton.js` | Loading skeleton | |
| `ui/skeletons/ModalSkeleton.js` | Generic modal skeleton | |
| `system/performance/useModalTiming.js` | Perf marks for modal open | Used by `ModalShell`, `ImmersivePreviewModal` |
| `system/errors/ModalErrorBoundary.js` | Error boundary per modal id | |
| `state/ui/modalStackStore.js` | Body scroll lock stack | `registerModal` / `unregisterModal` |

## page.js render wiring (line refs)

- Immersive singles: ~1541–1555 (`previewModalOpen && selectedSingle`)
- Immersive features: ~1557–1571 (`featureModalOpen && featureModalItem`)
- Album modal: ~1577–1688 (`selectedAlbum &&` AnimatePresence)
- AlbumTracklistSheet: ~2812–2818
- DonateModal: ~2801–2803 (dynamic import)

## Palette

- `ImmersivePreviewModal`: `useCoverPalette(coverSrc, coverType)` (~854), `paletteToCssVars` → `ModalShell` / body CSS vars
- Album modal: fixed `#0d0d0d` / `#00ffff` chrome (no cover-derived palette)
