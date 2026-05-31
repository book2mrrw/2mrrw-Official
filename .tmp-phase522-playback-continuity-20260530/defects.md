# Defects — Phase 5.2.2

**Total:** 2 significant (1 blocking), 3 minor/informational  
**Implementation policy:** Report only — no fixes applied

---

## D-522-001 — Multi-track titles overwritten (BLOCKING)

**Severity:** High  
**Status:** Open

### Symptom

Every track on an EP/mixtape/album displays and plays under the **release title** instead of the individual track title — in tracklist UI, now-playing bar, and MediaSession/lockscreen.

Example (`ad` release, track 1):

- Expected: `"2mrrw's Ntro"`
- Actual: `"2MRRW: (A.D)"`

All 10 Love Hz rows map to `"Love Hz Vol. 1"`.

### Root cause

`resolveAlbumTrackPlaybackItem` assigns the correct per-track title, then `normalizeCatalogItemForPlayback` calls `mergeCanonicalMetadata`, which resolves `item.slug` as the **release stream slug** and unconditionally sets:

```javascript
title: release.title,
display_title: release.title,
```

(`src/lib/media/canonical-catalog.js` ~508–524)

Album tracks intentionally use release slug for streaming entitlement, triggering the overwrite.

### Affected files

- `src/lib/media/canonical-catalog.js` — `mergeCanonicalMetadata`
- `src/lib/music-playback.js` — `normalizeCatalogItemForPlayback` (call site)

### Proposed fix

In `mergeCanonicalMetadata`, skip title/display_title overwrite when the item represents an album track:

```javascript
const isAlbumTrack = item.type === 'album_track' || item.trackSlug || item.metadata?.trackSlug;
return {
  ...item,
  ...(isAlbumTrack ? {} : { title: release.title, display_title: release.title }),
  // ... rest unchanged
};
```

Alternatively, pass `albumSlug` for release lookup and keep `slug` as track slug for metadata merge (higher touch).

### Risk

Low–medium. Display/metadata only; queue index and stream slug unaffected. Must verify singles/features still get release metadata.

---

## D-522-002 — Album/single modal close pauses playback

**Severity:** Medium  
**Status:** Open (may be intentional UX)

### Symptom

Closing the album detail modal or single preview modal stops playback.

### Root cause

```javascript
// src/app/page.js
const closeAlbumModal = useCallback(() => {
  setAlbumModalOpen(false);
  setSelectedAlbum(null);
  pause();  // ← stops playback
}, [pause]);

const closeSingleModal = useCallback(() => {
  ...
  pause();
}, [pause]);
```

Contrast: `AlbumTracklistSheet` `onClose` does **not** pause — playback continues.

### Affected files

- `src/app/page.js` — `closeAlbumModal`, `closeSingleModal`

### Proposed fix

Remove `pause()` from close handlers if continuity is desired; or scope pause to preview-only sessions (not active queue playback).

### Risk

Medium UX change — fans may expect modal close to stop preview but not album queue sessions.

---

## D-522-003 — Unavailable track tap falls back to first playable (minor)

**Severity:** Low  
**Status:** Informational

`resolveReleaseQueueStartIndex` returns `0` when tapped release index has no playable match. UI disables unavailable rows via `getPlayButtonState`, so user cannot tap in normal flow.

### Proposed fix

Return `-1` and no-op in handler when `found < 0`.

### Risk

Low

---

## D-522-004 — isTrackActive slug fallback ambiguity (minor)

**Severity:** Low  
**Status:** Informational

`AlbumTracklistSheet.isTrackActive` falls back to `currentTrack.slug === track.slug`. Album tracks share release stream slug. Mitigated by primary `id` check post-5.2.1.

### Proposed fix

Remove slug fallback; rely on `id` and `trackIndex + albumSlug` only.

### Risk

Low

---

## D-522-005 — page.js queue builder inconsistency (minor)

**Severity:** Low  
**Status:** Informational

`playAlbumTracks` uses `tracks.filter(t => Boolean(t.src))` instead of shared `playableReleaseQueue`. Equivalent today when playable tracks have `src`.

### Proposed fix

Use `playableReleaseQueue(tracks, accountState)` for consistency.

### Risk

Low
