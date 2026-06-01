# Viewport Focus Controller + True Playback Restore

**Date:** 2026-05-31  
**Scope:** Viewport audio focus handoff for Audio Visuals section only. No entitlement, stream resolution, or AudioProvider lifecycle changes.

---

## Files modified

| File | Change |
|------|--------|
| `src/lib/playback/focus-controller.js` | **NEW** — module-level focus owner + playback snapshot store |
| `src/context/AudioContext.js` | Viewport pause path, snapshot API, position resume |
| `src/app/page.js` | Audio Visuals IO enter/exit wired to focus controller |

---

## Functions added

### `src/lib/playback/focus-controller.js`

- `requestFocus(focus, playbackSnapshot)` — sets `activeFocus`, stores snapshot
- `releaseFocus()` — returns `{ activeFocus, snapshot }`, resets focus to `"music"`
- `getActiveFocus()` / `getSnapshot()` / `clearSnapshot()`
- Exported as `focusController`

### `src/context/AudioContext.js`

- `getCurrentPlaybackSnapshot()` — `{ trackId, releaseSlug, position, isPlaying }`
- `pauseForViewport()` — pauses `<audio>` without `userPausedRef`; uses `viewportPauseActiveRef` to block `onPause` auto-recover
- `resumeTrackAtPosition(trackId, position)` — same-track resume via `seekInternal` + `resumeInternal` only (no `playTrack`, no queue reset, no stream re-resolve)

### `src/app/page.js`

- `handleAudioVisualsFocused` — snapshot → `requestFocus("audioVisuals")` → `pauseForViewport` when playing
- `handleAudioVisualsExit` — `releaseFocus` → restore via `resumeTrackAtPosition` if snapshot had `isPlaying`
- `AudioVisualsSection`: `startAudioVisualPlayback` / `stopAudioVisualPlayback`; IO calls enter/exit on every intersect/leave (not one-shot pause)

---

## How `resumeTrackAtPosition` works

1. Confirms `hasStarted` and `currentTrack` still matches `trackId` (id / trackId / slug).
2. If `|audio.currentTime - position| > 0.25s`, calls `seekInternal(position)` (in-place seek, no new src).
3. If element is paused, calls `resumeInternal()` — existing resume path (`audio.play()`, media session, optional stream URL refresh only when already entitled and meta stale).
4. Does **not** call `playTrackInternal`, `setQueue`, or entitlement/stream resolution from scratch.

---

## Build / tests

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** |
| `npm run test:playback-resolver-fallback` | **PASS** (21 scenarios) |

---

## Acceptance test checklist (manual, iOS Safari first)

- [ ] Play track → scroll into Audio Visuals → music pauses, YouTube plays
- [ ] Scroll away → music resumes at same position, same track
- [ ] Play → manual pause → scroll into AV → away → stays paused
- [ ] Play → into AV → manual pause → away → stays paused
- [ ] Play → into AV → change track → away → no restore of previous track
- [ ] Fast scroll through AV — no double-audio, no resume loop
- [ ] Feature modal close (user `pause()`) → through AV → exit does not auto-resume
- [ ] Tab backgrounded while in AV — exit resume only when visible and eligible

---

## Out of scope (unchanged)

- Entitlement / preview 15s guest rule
- `playTrack` / stream client / queue lifecycle
- Hero/singles carousel `<video>` pause logic
- Global bar UI
