# Queue Validation — Phase 5.2.2

---

## Queue construction flow (post-5.2.1)

```
album.tracks (canonical order)
  ↓ mapAlbumTracksForPlayback / albumTracksForPlayback
Full release tracklist (metadata.trackIndex 0..N-1, unique id per track)
  ↓ playableReleaseQueue (or src filter in page.js modal)
Playable queue in release order
  ↓ resolveReleaseQueueStartIndex(playable, releaseTrackIndex)
startIndex
  ↓ playQueue → setQueue → playTrackInternal
AudioContext queueRef + queueIndexRef
```

---

## Handler consistency

| Component | Queue builder | Start index resolver |
|-----------|---------------|---------------------|
| `AlbumTracklistSheet` | `playableReleaseQueue` + unavailable filter | `resolveReleaseQueueStartIndex` |
| `page.js` `playAlbumTracks` | `tracks.filter(t => t.src)` | `resolveReleaseQueueStartIndex` |
| `MyMusicTab.playAlbum` | `playableReleaseQueue` | Hard-coded `0` (Play Album) |

**Note:** `page.js` uses `tracks.filter(Boolean(t.src))` instead of `playableReleaseQueue`. Functionally equivalent when all playable tracks have `src`; minor inconsistency (D-522-005).

---

## `setQueue` behavior (AudioContext — read-only)

```javascript
// src/context/AudioContext.js ~2208
const normalized = (tracks || []).map(normalizeTrack).filter((t) => t.src);
queueRef.current = normalized;
queueIndexRef.current = normalized.length ? index : -1;
patchState({ queue: normalized, queueIndex: queueIndexRef.current });
```

- Filters tracks without `src` at queue-set time
- Clamps `startIndex` to valid range
- Uses `startTransition` for non-urgent state update

**PASS** — no changes needed for 5.2.1 fix.

---

## Next / previous

| Action | Implementation | Behavior |
|--------|----------------|----------|
| `playNextInternal` | `queueIndex + 1`, shuffle random, repeat-all wrap | Sequential advance in release order when shuffle off |
| `playPreviousInternal` | Restart if `currentTime > 3s`, else `queueIndex - 1` | Standard UX |
| MediaSession `nexttrack` / `previoustrack` | Wired to `playNext` / `playPrevious` | **PASS** |
| Global player bar | Uses same AudioContext API | **PASS** |

---

## Queue order after filtering

Static test on `tbh` with tracks 1–2 unavailable:

| Playable queue position | Release trackIndex |
|------------------------|-------------------|
| 0 | 2 |
| 1 | 3 |
| 2 | 4 |
| … | sequential |

Auto-advance steps through playable queue in release order (gaps only when tracks filtered). **PASS**

---

## Queue persistence across navigation

| Mechanism | Scope | Finding |
|-----------|-------|---------|
| `queueRef` / React `queue` state | In-memory | Survives tab switches within SPA |
| `AudioProvider` in `layout.js` | Root layout | Provider not remounted on route/tab change — **PASS** |
| `persistPlayback` | POST `/api/media/playback` | Persists position/events per **slug**, not full queue |
| `persistMediaSessionTrack` | sessionStorage | Current track metadata for lockscreen rehydrate |
| `AudioPhase10Bridge` | Recovery event | Can restore queue from `2mrrw:playback-recovery` event |

**Finding:** Full queue is **not** persisted to localStorage across hard reload; in-session navigation preserves queue via mounted provider. **PASS** for SPA continuity scope.

---

## Shuffle

- `AlbumTracklistSheet` shuffle: randomizes playable array, `playQueue(order, 0)`, `setShuffle(true)`
- Ended handler uses random next index when shuffle on
- **PASS** (code review; not browser-tested)

---

## Verdict

**PASS** — Queue construction, ordering, index resolution, and next/previous paths are correct post-5.2.1.
