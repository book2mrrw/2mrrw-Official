# Media Session Validation — Lock Screen, Background, Car

**Phase 5.2.14** | Section result: **PASS**

---

## Summary

Media Session integration is **entitlement-agnostic**. Title, artist, artwork, play/pause, skip, and seek handlers operate on the single `AudioContext` `<audio>` element regardless of whether `src` is preview CDN or library stream proxy.

---

## Implementation map

| Concern | File / symbol | Entitlement fork? |
|---------|---------------|-------------------|
| Metadata (title, artist, artwork) | `updateMediaSession` ~L746 | ❌ |
| Position state / scrubber | `syncPositionState` ~L718 | ❌ (duration from audio element; preview cap is client seek logic, not Media Session metadata fork) |
| Persist / rehydrate on reload | `persistMediaSessionTrack` / `readPersistedMediaSessionTrack` | ❌ |
| Action: play | `handlePlay` → `resume()` ~L2776 | ❌ |
| Action: pause | `handlePause` → `pause()` ~L2779 | ❌ |
| Action: next / previous | `playNext` / `playPrevious` ~L2782–L2786 | ❌ |
| Action: seek | `handleSeek` → `seek()` ~L2788 | ❌ (seek internally caps preview via `previewOnly`) |
| Action: stop | `stop()` ~L2799 | ❌ |
| CS mode toggle | `togglemicrophone` → `toggleCSMode` ~L2812 | ❌ |
| End-of-queue idle | `mediaSession.playbackState = "none"` ~L1212 | ❌ |

---

## updateMediaSession behavior

Uses:

- `track.title`, `track.artist`, `track.album`
- Artwork from `track.cover` via `getArtworkEntriesForTrack` — **not** from audio `src`
- CS mode adds `◈` suffix to title — presentation mode, not entitlement tier

Does **not** read:

- `metadata.access.canStream`
- `metadata.access.previewOnly`
- Preview vs stream URL hostname

---

## Background / visibility

`visibilitychange` handler (~L2838):

- Saves playback position to local storage when hidden.
- Does not branch on guest vs subscriber.
- Stream session analytics (`finalizeStreamSession`) tied to stream meta — runs for entitled streams only because guests never establish stream sessions, not because of a separate Media Session path.

---

## Lock screen / CarPlay / Bluetooth

| Scenario | Guest (preview) | Entitled (stream) |
|----------|-----------------|-------------------|
| Title / artwork display | Same metadata pipeline | Same |
| Play / pause remote | `resumeInternal` / `pauseInternal` | Same |
| Next / previous track | `playNextInternal` / `playPreviousInternal` | Same |
| Scrubber duration | `audio.duration` (preview clip length) | Full track duration |
| Position updates | `setPositionState` throttled | Same |

Preview **duration** reflects preview asset length; that is asset resolution, not a Media Session entitlement fork.

---

## Preview-only playback semantics (same session)

These run in `timeupdate` / `ended` / `seekInternal` on the same element:

- 30s hard cap (`PREVIEW_HARD_CAP_SEC`)
- Fade before cap
- `playbackState: ended_preview`
- Seek capped at 30s in `seekInternal` ~L2499

Media Session still receives position updates from the same audio element; lock screen scrubber may show full preview file duration while app enforces cap — pre-existing behavior, not tier-specific session stack.

---

## Service worker / keep-alive

`startKeepAlivePing` / `postKeepAliveToServiceWorker` — active during playback for all sources. No guest/subscriber split.

---

## Section result

**PASS** — One Media Session wiring; no entitlement-based fork in lock screen, background, or car remote handling.
