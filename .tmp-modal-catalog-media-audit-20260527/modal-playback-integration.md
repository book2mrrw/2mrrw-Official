# Modal playback integration

## Shared engine

All modal and card players use the **same** `AudioContext` instance (provider in app layout). There is no second `<audio>` for modals.

| UI surface | Hooks | Controls playback via |
|------------|-------|---------------------|
| `ImmersivePreviewModal` mobile `FloatingPlayer` | `useAudioPlayer`, `useMediaEngine` | `playTrack`, `toggle`, `seek` (~457, 475–489) |
| Desktop `PreviewPlayerControls` | `useMediaEngine`, `useAudioPlayer` | `toggle`, `seek` (~160–170, 220–230) |
| `GlobalAudioPlayerBar` | `useImmersivePlayback`, `useMediaEngine` | `handlePlayToggle` → `engineToggle` |
| `AlbumTracklistSheet` | `useAudioPlayer` | `playQueue`, `toggle` |
| `ReleaseCardPlayButton` | `useAudioPlayer` | `playQueue` |

## Immersive modal player UI

### Mobile (`MobileV9Layout` in `ImmersivePreviewModal.js`)

| Piece | Line ref | Notes |
|-------|----------|-------|
| `FloatingPlayer` | ~255–324, ~607–616 | `Waveform`, `ScrubBar`, play/pause |
| Preview cap | ~463–472 | `effectiveDuration` / `effectiveCurrent` min with 30s when `previewOnly` |
| `isThisTrack` | ~460–461 | UI play state only when `currentTrack.slug === single.slug` |
| Beat animation | `useBeat` ~96–111 | Cosmetic |

### Desktop (`ImmersiveModalStage` + `PreviewPlayerControls`)

- Stage visualizer: `ImmersiveModalScene` + analyser from engine (~47–55)
- Panel: `ImmersiveModalPanel` embeds `PreviewPlayerControls` (~60+)
- Floating variant on mobile stage (~72–79)

### Palette

- `useCoverPalette(coverSrc)` → CSS variables on shell (~854–855, 1033)
- `PlayerAtmosphere open` inside `ModalShell` (~1039)

## Preview vs full in modal

| Signal | Source |
|--------|--------|
| `trackAccess` prop | Parent `resolveContentAccess` in page.js (~1076–1082, 1080–1082) |
| `previewOnly` | `Boolean(trackAccess && !trackAccess.canStream)` ImmersivePreviewModal ~857 |
| `canStream` | `trackAccess?.canStream` ~856 |
| Preview ended UI | `previewEnded` from AudioContext + `PreviewEndedCTA` ~861–892 |
| 30s label | Mobile art zone ~556–582; `PreviewPlayerControls` stream hint ~240 |

Full stream: scrub duration from engine; preview: capped display and seek (~484–491 mobile, PreviewPlayerControls ~197–216).

## Global bar vs modal

| Behavior | When immersive modal open |
|----------|---------------------------|
| `GlobalAudioPlayerBar` | **Still rendered** if `hasStarted && currentTrack` (layout-level) |
| `page.js` `nowPlaying` mini player | **Suppressed** — effect only sets `nowPlaying` when `!previewModalOpen && !featureModalOpen` (~983–999) |
| Modal close | `closeSingleModal` / `closeFeatureModal` call **`pause()`** (~1177, 1153) |
| Album modal close | `pause()` (~1182) |

**Implication:** User can see **global dock + modal floating player** simultaneously during single/feature preview.

## `useMediaEngine` in modals

- Drives waveform/scrub **display** time and analyser-driven visuals
- `toggle` in modal should match global bar (same bridge)

## Modal open already playing

`openSingleModal` / `openFeatureModal` call `playTrack` with `toPlaybackTrack` **before** modal content mounts. Modal UI syncs to existing `currentTrack` via slug match—not a separate play initiation on mount (except deferred auth effect ~951–981).

## In-modal play/pause edge case

`handlePlayPause` when not current track:

```javascript
void playTrack({ ...single }, { resumeAt: 0 });
```

(~475–478) — spreads catalog object **without** `toPlaybackTrack`. Opener path includes resolved `src` and `metadata.access`. Risk if user pauses and resumes from modal controls on a different entitlement state than opener.

## Album modal

Uses same `playTrack` / `playQueue` from page callbacks—not immersive floating player. No cover-derived palette player; inline track list only.
