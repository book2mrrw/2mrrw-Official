# Phase 3 — Play Path Trace

## Card play button (latest singles/features cards)
1. `src/components/music/ReleaseCardPlayButton.js:L97` binds `onClick={handlePlay}`.
2. `handlePlay` (`L38-L80`) builds track and calls `void playQueue([track], 0)` at `L58` (no await at callsite).
3. `playQueue` in `src/context/AudioContext.js:L1895-L1899` calls `playTrack(...)`.
4. `playTrack` starts at `L1178`; before any stream resolve it runs:
   - `void unlockAudioFromGesture(audioEl)` (`L1181`)
   - `await resumeWebAudioContextIfSuspended(audioCtxRef)` (`L1185`)
5. Eventual playback occurs later via async helpers (`loadAudioSrcAndPlay` => `await waitAudioSrcReady` then `await audio.play()` at `L114`) and other async branches.

### Gesture chain breakpoints
- `void unlockAudioFromGesture(...)` not awaited (`L1181`) while containing async `await audioEl.play()` (`L1170`).
- Explicit await before playback path (`L1185`).
- Stream fetch / source swap async stages before final play (`L1145+`, `L1337+`, `L1500+`).

## Cover art tap -> modal open path
1. `src/app/page.js:L1842` calls `openSingleModal(singleUi)`.
2. `openSingleModal` (`L1104-L1136`) opens modal state, creates `playbackTrack`, then `if (playbackTrack?.src) void playTrack(playbackTrack);` (`L1124`).
3. `playTrack` then follows same async sequence as above (`src/context/AudioContext.js:L1178+`).

### Gesture chain breakpoints
- Same async boundaries in `playTrack` (notably `L1181`, `L1185`) apply here too.
