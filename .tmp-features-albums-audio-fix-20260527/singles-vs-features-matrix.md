# Singles vs Features vs Album tracks — property matrix

## Catalog item shape (inline `page.js`)

| Field | Latest Singles | Features | Album (container) | Album track (string) |
|-------|----------------|----------|-------------------|----------------------|
| `slug` | ✓ e.g. `hour-glass` | ✓ e.g. `2-heavy` | ✓ e.g. `tbh` | ✗ was album slug |
| `type` | `single` | `feature` | `album` | — |
| `preview` | `.mp3` path | `.wav` path | ✗ none | ✗ none |
| `video` | ✓ MP4 | ✗ | ✗ | ✗ |
| `cover` | ✓ | ✓ | ✓ | inherits album |
| `featuring` | ✗ | ✓ | ✗ | ✗ |
| `tracks[]` | ✗ | ✗ | ✓ strings | title only |

## After `normalizeCatalogItemForPlayback` + lookup

| Field | Single | Feature | Album track (e.g. "Hour Glass" on Love Hz) |
|-------|--------|---------|---------------------------------------------|
| `slug` | unchanged | unchanged | **`hour-glass`** (from title alias / catalog) |
| `preview` | R2 HTTPS URL | R2 HTTPS URL | **`hour-glass` preview** when matched |
| `albumSlug` | — | — | `love-hz` |
| `src` (guest) | `catalogPreviewAudioUrl` | `catalogPreviewAudioUrl` | matched single preview |
| `src` (entitled) | `/api/library/stream?slug=…` | same | per-track product slug |

## Playback call chain (post-fix)

```
Cover tap → openFeatureModal / openSingleModal / openAlbumModal
         → resolveCatalogPlaybackItem(item, catalogPlaybackLookup)
         → toPlaybackTrack(normalized, accountState, source)
         → playTrack / playQueue → AudioContext (single <audio>)
```

Modal UI play/pause → `useMediaEngine().toggle()` only (no second `playTrack` with raw item).

## `metadata` on playback track

| Key | Purpose |
|-----|---------|
| `access` | From `resolveTrackAccess` — stream vs preview |
| `previewSrc` | CDN preview URL for 401 fallback in `AudioContext` |
| `albumSlug` | Album queue identity |
| `trackIndex` | Row index in album modal / sheet |
