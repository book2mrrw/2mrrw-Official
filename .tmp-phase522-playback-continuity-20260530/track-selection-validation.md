# Track Selection Validation — Phase 5.2.2

**Scope:** Singles, EPs, mixtapes, albums — tap tracks 1, 3, 5, 7, last  
**Commit:** `8997d9e`

---

## Code paths audited

| Entry point | Handler | Queue API |
|-------------|---------|-----------|
| Storefront album modal row tap | `playAlbumModalTrackAtIndex` → `playAlbumTracks(album, index)` | `playQueue(playable, resolveReleaseQueueStartIndex(...))` |
| Album tracklist sheet row tap | `AlbumTracklistSheet.playAndClose(index)` | Same |
| My Music → Play album | `MyMusicTab.playAlbum` | `playQueue(playableReleaseQueue(...), 0)` |
| Singles / features | `playCanonicalCatalogItem` / `playItem` | `playTrack` (single-item, no queue) |

---

## Static validation (canonical catalog)

Script: Node import of `mapAlbumTracksForPlayback`, `playableReleaseQueue`, `resolveReleaseQueueStartIndex` with `subscriberActive: true`.

### Unique track IDs

All tracks receive `{albumSlug}:{trackSlug}` IDs (e.g. `ad:03-said-n-done`). No duplicate IDs within a release. **PASS**

### Release trackIndex

Full tracklists preserve `metadata.trackIndex` 0..N-1 before filtering. **PASS**

### Tap → queue index (tracks 1, 3, 5, 7, last)

| Release | Tracks | Taps tested | Result |
|---------|--------|-------------|--------|
| `love-hz-vol-1` | 10 | 1, 3, 5, 7, 10 | **PASS** all map to correct queue index |
| `ad` | 11 | 1, 3, 5, 7, 11 | **PASS** |
| `tbh` | 9 | 1, 3, 5, 7, 9 | **PASS** |

Example (`ad`, tap track 7 / release index 6):

```
releaseTrackIndex 6 → queueIndex 6 → id ad:07-a2b
```

### Filtered tracklist edge case

When tracks 1–2 have empty `src` (simulated unavailable):

- Tap track 5 (index 4) → queue index 2, `trackIndex` 4 — **PASS**
- Tap track 1 or 2 (unavailable) → falls back to queue index 0 (first playable) — see D-522-003 in defects (UI disables these rows)

---

## Title, artwork, duration, metadata

| Field | Singles | Multi-track releases |
|-------|---------|----------------------|
| **Title** | Correct (release slug = item slug) | **FAIL** — all tracks show release title |
| **Artwork** | Per-item cover | Release cover applied per track — **PASS** |
| **Duration** | From metadata when present | Track rows show duration when `metadata.durationSeconds` set — **PASS** (UI) |
| **metadata.trackIndex** | N/A | **PASS** — stable 0..N-1 |
| **metadata.trackSlug** | N/A | **PASS** — canonical track slug |
| **metadata.albumSlug** | N/A | **PASS** |
| **Active queue index** | N/A (single track) | **PASS** via `resolveReleaseQueueStartIndex` |

### Root cause of title failure

`resolveAlbumTrackPlaybackItem` sets correct per-track title (e.g. `"2mrrw's Ntro"`), but `normalizeCatalogItemForPlayback` → `mergeCanonicalMetadata` looks up `item.slug` (release stream slug `ad`) and **overwrites** `title` with release title `"2MRRW: (A.D)"`.

Evidence:

```
raw track title: 2mrrw's Ntro
resolved item title (after normalize): 2MRRW: (A.D)
```

All 10 Love Hz tracklist rows map to title `"Love Hz Vol. 1"`.

**Affected files:** `src/lib/media/canonical-catalog.js` (`mergeCanonicalMetadata`), `src/lib/music-playback.js` (`normalizeCatalogItemForPlayback`)

---

## Active row highlighting (`AlbumTracklistSheet.isTrackActive`)

Primary match: `currentTrack.id === track.id` — **PASS** (unique IDs post-5.2.1)

Fallback `currentTrack.slug === track.slug` would match any track on same release (shared stream slug). Low risk while `id` is set; see D-522-004.

---

## Browser validation (production)

- **URL:** https://www.2mrrw.com @ 375px mobile emulation
- **Limitation:** Join modal blocks interaction; no authenticated session for entitled album streaming
- **Singles preview tap:** Inconclusive (gesture/autoplay chain after modal removal)
- **Album tracklist tap:** Not executed (auth + entitlement required)

---

## Verdict

| Criterion | Status |
|-----------|--------|
| Correct track plays (queue index) | **PASS** (static) |
| Title / lockscreen metadata | **FAIL** |
| Artwork | **PASS** |
| Active queue index | **PASS** |
