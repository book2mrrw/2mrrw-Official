# Modal system — root cause analysis (2026-05-27)

## "Try Again" in immersive modals

**Source:** `ModalErrorBoundary` → `ModalErrorFallback` (`src/system/errors/FallbackRenderer.js`) with copy "This panel could not load. You can try again or close."

**Primary throw (confirmed):** `ImmersivePreviewModal` `SingleModal` built `viewMoreRows` with:

```js
creditRows.slice(0, 3).forEach(([k, v]) => rows.push([k.toUpperCase(), v]));
```

`getCreditsDisplayRows()` returns `{ key, label, value }` objects, not `[k, v]` tuples. Array-destructuring a plain object triggers **`TypeError: object is not iterable`** during render whenever editorial credits exist (common for catalog singles/features with static credit metadata).

**Secondary risks (fixed):**

| Area | Issue | Symptom |
|------|--------|---------|
| Features rail | `feat.price.toFixed(2)` when `price` missing | Uncaught TypeError on card render |
| Album modal | Track row click only `seek(0)` | UI active track diverged from global queue |
| Modal lifecycle | Opening album left preview/feature state open | Overlapping modals + stale `nowPlaying` chip |
| React keys | `key={single.slug}` / `key={feat.slug}` only | Reconciliation warnings if slug absent |

## Account tab (verified — already fixed on `main`)

Prior audit: `currentUser.name[0]` when `name` empty → site `error.js` "Try again".

**Current code:** `accountDisplayName` + `accountDisplayInitial` with `((accountDisplayName \|\| "?")[0] \|\| "?")` — no unsafe `name[0]` in account tab render path.

## Architecture trace (three sections)

### Latest Singles

| Step | Location |
|------|----------|
| Click | `page.js` card `onClick={() => openSingleModal(singleUi)}` |
| State | `selectedSingle`, `previewModalOpen`, `selectedReleaseDetail` |
| Playback | `openSingleModal` → `toPlaybackTrack` + `playTrack` (F2, commit `04dc78d`) |
| Render | `AnimatePresence` → `ModalErrorBoundary` → `ImmersivePreviewModal` (`SingleModal`) |
| Cleanup | `closeSingleModal` clears state + `pause()` |

### Features

| Step | Location |
|------|----------|
| Click | `FeaturesRail` `onOpenFeature(feat)` |
| State | `featureModalItem`, `featureModalOpen`, `featureReleaseDetail` |
| Render | Same `ImmersivePreviewModal` with `key="immersive-feature-modal"` |
| Mutual exclusion | `openSingleModal` / `openAlbumModal` dismiss feature state |

### Albums & EPs

| Step | Location |
|------|----------|
| Card click | `CatalogGrid` `onCardClick={openAlbumModal}` |
| Tracklist sheet | Separate: `AlbumTracklistSheet` + `albumTracklistRelease` (queue play, not V9 modal) |
| State | `selectedAlbum`, `albumModalOpen` |
| Render | `AlbumModal` / `AlbumModalView` (V9 in `ImmersivePreviewModal.js`) |
| Playback | Open: `playAlbumTracks(album, 0)`; row: `onPlayTrackAtIndex` → `playAlbumTracks(selectedAlbum, index)` |
