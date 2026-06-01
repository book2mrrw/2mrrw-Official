# Playback Stop / Pause / Queue Commands

**Command router:** `dispatchPlaybackCommand` → `executePlaybackCommand` (`AudioContext.js` L2765–2753)

---

## Command → implementation

| Command | Executor | Element / state effect |
|---------|----------|------------------------|
| `PAUSE` | `pauseInternal` L2557 | `userPausedRef=true`; `audioRef.pause()` — **track/src preserved** |
| `INTERRUPT` | `pauseInternal` L2733 | Same as PAUSE (OS/interrupt path) |
| `STOP` | `stopInternal` L2684 | Pause + **remove src** + `load()` + `setState(EMPTY_STATE)` + clear queue |
| `RESUME` / `RECOVER` | `resumeInternal` L2562 | `audio.play()`; may background-refresh stream URL |
| `PLAY_TRACK` | `playTrackInternal` L1658 | May abort prior stream; assign src; play |
| `PLAY_QUEUE` | `playQueueInternal` L2551 | `setQueue` + `playTrackInternal` |
| `SEEK` | `seekInternal` L2646 | `currentTime` |
| `NEXT_TRACK` / `PREV_TRACK` | `playNext/PreviousInternal` | Queue index + new play |
| `COMPLETE` | `playNextInternal({ autoAdvance: true })` | From ended handler chain |

**Public API:** `pause`, `resume`, `toggle`, `stop`, `playTrack`, `playQueue`, `setQueue` (L3281–3311)

---

## External callers of `pause()` (useAudioPlayer)

| Trigger | File:line | Chain |
|---------|-----------|-------|
| Audio Visuals IO focus | `page.js` L760–762 | `handleAudioVisualsFocused` → `pause()` |
| Feature modal close | `page.js` L1334–1338 | `closeFeatureModal` |
| Dismiss now playing | `page.js` L1385–1387 | `dismissNowPlaying` |
| Media session pause | `AudioContext.js` ~L2988 | handler → `pause()` |
| `toggle()` when playing | `AudioContext.js` L2910–2911 | |

---

## Direct `audio.pause()` inside AudioContext (bypass command queue)

| Context | Lines | Notes |
|---------|-------|-------|
| Preview 15s cap | L1154 | `skipPauseInterruptionRef` |
| ACCESS_DENIED after retry | L1453, L1806 | |
| CS mode src swap | L2361, L2404 | `skipPauseInterruptionRef` |
| `pauseInternal` | L2559 | User pause |
| `stopInternal` | L2700 | Full stop |
| `beginCsHoldPreview` | L3182 | Hold-to-preview |
| `endCsHoldPreview` | L3238 | Restore after hold |
| `unlockAudioFromGesture` | L1651 | Silent unlock |

---

## `setQueue` callers

| Source | Condition | File |
|--------|-----------|------|
| `playQueue` / `playQueueInternal` | User/album play | `AudioContext.js` L2551–2554 |
| `AudioPhase10Bridge` | `2mrrw:playback-recovery` **only if** `!hasStarted && queue.length===0` | L35–65 |
| Tests / internal | — | — |

**No `setQueue` from:** `AuthContext`, scroll handlers, modal close (single/album).

---

## `stop()` callers

| Source | File |
|--------|------|
| Media Session `stop` action | `AudioContext.js` L3000–3001 |
| UI using `stop` from context | Grep shows **only** media session in AudioContext |

---

## `stopInternal` vs `pauseInternal`

| | pause | stop |
|---|-------|------|
| Queue | Kept | Cleared |
| `currentTrack` | Kept | Cleared (`EMPTY_STATE`) |
| `audio.src` | Kept | Removed |
| User perception | Paused mid-track | Player reset |

---

## Interrupt / visibility recover

| Path | Behavior |
|------|----------|
| Unintended `pause` event | `onPause` L1119–1136 schedules resume on `canplay` if `stateRef.isPlaying` |
| `visibilitychange` visible | May `dispatchPlaybackCommand(RECOVER)` L3088–3103 |
| Tab background | **Does not pause** music (saves position only) L3044–3081 |
