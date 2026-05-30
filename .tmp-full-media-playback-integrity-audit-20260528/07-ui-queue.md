# 07 — UI & queue (code-level)

## Catalog playback unification

| Module | Role |
|--------|------|
| `buildCatalogPlaybackLookup` | Merges singles/features/albums by slug + title |
| `resolveCatalogPlaybackItem` | Modal open / play uses merged preview + slug |
| `toPlaybackTrack` | Sets `metadata.access`, `src` via `resolvePlaybackSrc` |
| `playAlbumTracks` | Builds queue from album track list + lookup |

## Album queue risks

- Inline `albums[].tracks` are **strings** (titles), not slugs
- `resolveAlbumTrackStreamSlug` returns album slug when track string has no catalog match
- Subscriber entitled to album may get **one** stream key for whole album — per-track CS media required for track-level full audio

## Queue / Media Session

**File:** `AudioContext.js`

- `queueRef`, `queueIndexRef`, shuffle, `playQueue`
- `updateMediaSession` + `persistMediaSessionTrack` for lock screen
- `queueCircuitOpenRef` / watchdog — prevents runaway auto-advance on errors

## UI failure modes

| Symptom | Likely code path |
|---------|------------------|
| Modal opens, no audio | `preview` undefined on album; `resolvePlaybackSrc` empty |
| Feature play silent (entitled) | Stream 404 on WAV key; HEAD assert fails |
| Queue skips / stops | `queueCircuitOpenRef` after repeated stream errors |
| Wrong track metadata | Title-only album row without `catalogPlaybackLookup` merge |

## Components

- `CatalogGrid.js` — `albumCardPlaybackItem` for album cards
- `FeaturesRail.js` — `onOpenFeature` → page modal + play
- `ImmersivePreviewModal` / `AlbumModal` — receive `catalogPlaybackLookup`
