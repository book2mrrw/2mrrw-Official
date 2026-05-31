# Phase 5.2.1 — Tracklist Playback Correction

**Date:** 2026-05-30  
**Repository:** `/Users/recharge/artist-platform`  
**Scope:** Queue construction and track-selection handlers only  
**Zip:** `/Users/recharge/Downloads/phase521-tracklist-playback-20260530.zip`

---

## Executive summary

Multi-track release playback (mixtapes, EPs, albums) was starting at Track 1 regardless of which row the fan tapped, and auto-advance could stall because the queue start index was wrong. Root cause was shared release-level `id`/`slug` on every album track plus index resolution that used filtered-array positions instead of stable `metadata.trackIndex`. Handlers now build a full release tracklist, derive a playable queue in release order, and resolve start index by release position.

---

## Root cause

### 1. Shared identity on all album tracks

`resolveAlbumTrackPlaybackItem` sets `slug` to the **release stream slug** (album/mixtape product slug) for entitlement streaming. `normalizeTrackForPlayback` then set `id` from that slug, so every track on a release shared the same `id`.

Queue start resolution used:

```javascript
playable.findIndex(
  (t) => t.id === tapped.id && t.metadata?.trackIndex === tapped.metadata?.trackIndex
);
```

When `trackIndex` was missing or mismatched, `id === tapped.id` matched **the first track** → `queueIndex` defaulted to **0** (Track 1).

### 2. Filtered tracklist vs release track index

`albumTracksForPlayback` previously returned `filterPlayableQueueItems(mapped)` — a **shortened** array. UI handlers and `AlbumModal` pass **release track index** (position in full `album.tracks`), but lookup used `tracks[startIndex]` on the filtered array. Tapping Track 9 when earlier tracks were unavailable could yield `undefined` → fallback to index 0.

### 3. Auto-advance dependency

`AudioContext` auto-advance uses `queueIndex + 1` on the queue set by `playQueue`. Wrong start index means the queue is correct but playback begins at track 0; advance then continues from the wrong position. Fixing start index restores expected N → N+1 behavior without touching `AudioContext.js`.

---

## Files modified

| File | Change |
|------|--------|
| `src/lib/music-playback.js` | Split `mapAlbumTracksForPlayback` (full release list), `playableReleaseQueue`, `resolveReleaseQueueStartIndex`; unique per-track `id` as `{albumSlug}:{trackSlug}` |
| `src/components/music/AlbumTracklistSheet.js` | `playAndClose` uses release index → queue index via helper |
| `src/app/page.js` | `playAlbumTracks` uses `resolveReleaseQueueStartIndex` for album modal taps |
| `src/components/music/MyMusicTab.js` | `playAlbum` passes `playableReleaseQueue` to `playQueue` |

**Not modified:** `AudioContext.js`, signed URL, entitlement resolver, hybrid streaming, audiovisual.

---

## Queue flow (after fix)

```
album.tracks (canonical release order)
    ↓ mapAlbumTracksForPlayback / albumTracksForPlayback
Full release tracklist (all rows, metadata.trackIndex = 0..N-1, unique id per track)
    ↓ playableReleaseQueue (or src filter in page.js modal path)
Playable queue [track₁ … trackₙ] in release order
    ↓ resolveReleaseQueueStartIndex(playable, releaseTrackIndex)
startIndex in playable array
    ↓ playQueue(playable, startIndex)  [existing AudioContext API]
Queue stored; track at startIndex plays; ended → queueIndex + 1
```

---

## Playback flow (user tap)

| User action | Handler | Result |
|-------------|---------|--------|
| Tap Track N in `AlbumTracklistSheet` | `playAndClose(N)` | `playQueue(playable, indexOf trackIndex===N)` |
| Tap Track N in album modal | `playAlbumModalTrackAtIndex(N)` → `playAlbumTracks(album, N)` | Same resolution |
| Play All / Shuffle | `playAndClose(0, shuffle?)` | Index 0 or shuffled playable list |
| My Music → Play album | `playAlbum` | `playQueue(playable, 0)` — first playable track |

**Expected behavior:** Tap Track 1 / 5 / 9 → plays that track; on end → next track in release order auto-starts.

---

## Validation

| Check | Result | Notes |
|-------|--------|-------|
| `npm run build` | **PASS** | Compiled successfully |
| `npm run test:foundation` | **2 pre-existing FAIL** | HEAD vs `foundation-stable-v3` anchor drift (uncommitted work); no playback-related smoke failures |

---

## Rollback

Selective restore (preferred):

```bash
git checkout HEAD -- \
  src/lib/music-playback.js \
  src/components/music/AlbumTracklistSheet.js \
  src/app/page.js \
  src/components/music/MyMusicTab.js
```

Or full foundation recovery if broader rollback needed:

```bash
npm run recover:foundation
npm run verify:foundation
```

---

## Verdict

**COMPLETE** — Tracklist tap index and release-scoped queue construction corrected with minimal leaf-handler + queue-helper changes; playback engine untouched.
