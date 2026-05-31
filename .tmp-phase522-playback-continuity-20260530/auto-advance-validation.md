# Auto-Advance Validation — Phase 5.2.2

---

## Ended handler (AudioContext — read-only)

Location: `src/context/AudioContext.js` ~1071–1132

Flow on `audio.ended`:

1. Finalize stream session + local listening history
2. `patchState({ playbackState: "ending" })`
3. After 2s delay (`setTimeout(finishEnded, 2000)`):
   - **Repeat one:** restart current track
   - **Queue present:** `nextIndex = queueIndex + 1`
     - Shuffle: random index (≠ current)
     - End of queue + repeat-all: wrap to 0
     - End of queue + no repeat: idle, clear MediaSession
   - **`playTrackRef.current(nextTrack, { resumeAt: 0 })`**
   - Update `queueIndexRef` and state

**Not modified in 5.2.1** — relies on correct initial `queueIndex` from leaf handlers.

---

## Dependency on 5.2.1 fix

Pre-5.2.1: wrong start index meant auto-advance continued from track 0's position in queue, not tapped track.

Post-5.2.1: static validation confirms playable queue preserves release order with contiguous `trackIndex` metadata. Auto-advance `queueIndex + 1` advances to next release track.

| Scenario | Expected | Static result |
|----------|----------|---------------|
| Start track 1, end → track 2 | queueIndex 0 → 1 | **PASS** |
| Start track 5, end → track 6 | queueIndex 4 → 5 | **PASS** |
| Last track, repeat off | Idle | **PASS** (handler logic) |
| Last track, repeat all | queueIndex N-1 → 0 | **PASS** (handler logic) |
| Middle track on EP (Love Hz track 5) | Advance to track 6 | **PASS** (queue order) |

---

## Edge cases

| Case | Behavior | Status |
|------|----------|--------|
| Single-track queue (single play) | No queue or length 1 → idle after end | **PASS** |
| Play All from tracklist | Starts index 0, advances through full queue | **PASS** |
| Unavailable tracks filtered from queue | Auto-advance skips gaps (not in playable array) | **PASS** |
| 2s inter-track delay | Intentional pause before next track | Documented behavior |
| Stream error mid-queue | Retry/fallback in `onError`; separate from advance | Not in scope |

---

## Browser validation

Not executed — requires entitled session and full track playback to natural end. Code-path + static queue order validation only.

---

## Verdict

**PASS** — Auto-advance logic is sound given corrected queue start index and release-ordered playable arrays.
