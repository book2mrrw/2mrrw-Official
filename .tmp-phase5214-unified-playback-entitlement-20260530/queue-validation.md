# Queue Validation — Unified Behavior Across User Types

**Phase 5.2.14** | Section result: **PASS**

---

## Principle

Queue mechanics live entirely in `AudioContext.js`. Queue **contents** differ by entitlement (preview `src` vs stream `src`), but **navigation semantics** are identical for Guest, Subscriber, Collector card owner, Purchaser, and Admin.

---

## Core APIs (single implementation)

| API | Location | Entitlement branch? |
|-----|----------|---------------------|
| `setQueue(tracks, startIndex)` | AudioContext ~L2322 | ❌ Filters `t.src` only |
| `playQueue(tracks, startIndex, options)` | ~L2399 | ❌ Delegates to setQueue + playTrackInternal |
| `playNextInternal` | ~L2337 | ❌ Index math + playTrackInternal |
| `playPreviousInternal` | ~L2355 | ❌ Seek-to-0 if >3s, else index decrement |
| Auto-advance (`onEnded`) | ~L1198–L1229 | ❌ Uses `playTrackRef.current(nextTrack)` |
| `resumeInternal` | ~L2410 | ❌ Same audio element; may refresh stale stream URL for entitled |

---

## Queue construction (entitlement at build time only)

| Site | Builder | Guest queue | Entitled queue |
|------|---------|-------------|----------------|
| `AlbumTracklistSheet` | `albumTracksForPlayback` → `playableReleaseQueue` | Preview `src` per track | Stream redirect `src` per track |
| `page.js` album modal | Same | Same | Same |
| `ReleaseCardPlayButton` | `playQueue([track], 0)` | Single preview track | Single stream track |
| Library / playlists | `toPlaybackTrack` per item | N/A (MyMusicTab gates `!canStream`) | Stream URLs |

**Key:** `playableReleaseQueue` filters tracks with truthy `src` after `normalizeTrackForPlayback` already applied entitlement-specific URLs. No second queue builder for guests.

---

## Album / tracklist / playlist parity

```text
AlbumTracklistSheet.playAndClose
  → albumTracksForPlayback(album, accountState, …)
  → playableReleaseQueue(tracks, accountState)
  → playQueue(playable, resolveReleaseQueueStartIndex(...))

page.js album modal
  → albumTracksForPlayback (same)
  → playQueue(playable, queueIndex)

Both → AudioContext.setQueue → playTrackInternal
```

- **Shuffle:** `setShuffle(true)` + random reorder before `playQueue` — same for all tiers.
- **Track index:** `metadata.trackIndex` + `resolveReleaseQueueStartIndex` — album slug shared across tracks; `trackSlug` passed to stream API for entitled users.
- **Repeat modes:** `repeatModeRef` — off / all / one — no entitlement check.

---

## Auto-advance

On `ended` event (~L1198):

1. Repeat-one → restart same track (all tiers).
2. Else advance `queueIndex` (shuffle or sequential).
3. Call `playTrackRef.current(nextTrack, { resumeAt: 0, playbackScenario: QUEUE_AUTO_ADVANCE })`.

**Guest:** next track plays preview `src`; 30s cap applies per track via existing `previewOnly` handlers — not a separate auto-advance path.

**Entitled:** next track may background-resolve stream URL — same as first-track entitled behavior.

---

## playNext / playPrevious / Media Session skip

Media Session handlers (~L2782–L2786):

```javascript
handleNext → playNext()
handlePrev → playPrevious()
```

These invoke the same `playNextInternal` / `playPreviousInternal` as UI buttons. No `canStream` checks.

---

## Resume after pause / background

`resumeInternal`:

- Calls `audio.play()` on current `src`.
- Entitled: may refresh expired signed stream via `fetchLibraryStream` — preview CDN URLs unaffected.
- Guest: resumes preview at capped position (seek already capped in `seekInternal`).

---

## filterPlayableQueueItems / isQueueTrackPlayable

`music-playback.js`:

- Marks `playbackStatus: preview_only` vs `ready` based on `access.previewOnly` — metadata only.
- `isQueueTrackPlayable`: requires `track.src` OR preview path — does not fork queue navigation.

---

## Prewarm interaction

`playback-prewarm-cache.js` stores `firstTrackPlayback` from `toPlaybackTrack` — same entitlement rules as live play. `ReleaseCardPlayButton` prefers prewarmed `normalizedFirst` but still calls unified `playQueue`.

---

## Validation vs Phase 5.2.12

Phase 5.2.12 confirmed queue does not depend on `/api/media/preview` redirect hop. Phase 5.2.14 confirms queue also does not depend on **user tier** — only on pre-resolved `track.src`.

---

## Section result

**PASS** — One queue, one advance/previous/resume implementation; entitlement affects queue **payload** at construction, not navigation logic.
