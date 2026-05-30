# Phase 2 — Desktop vs Mobile Divergence (A-F)

## A — Gesture chain
- `audio.play()` call sites are spread across helpers, event handlers, and async flows in `src/context/AudioContext.js` (e.g., `L114`, `L126`, `L767`, `L881`, `L977`, `L1170`, `L1551`, `L1798`, `L1917`, `L2251`, `L2301`).
- In `playTrack`, execution hits `await resumeWebAudioContextIfSuspended(audioCtxRef)` at `L1185` before later playback work, so direct tap -> `audio.play()` is not synchronous.
- `unlockAudioFromGesture` is invoked with `void` at `L1181` and itself performs `await audioEl.play()` (`L1170`) asynchronously; it is not awaited by `playTrack`.
- Additional `audio.play()` calls in `visibilitychange` resume path (`L2159`) and interruption resume (`L767`) are outside explicit user gesture handlers.
- Assessment: **Possibly Yes** (strong iOS risk due to broken synchronous gesture chain).

## B — AudioContext state
- `resumeWebAudioContextIfSuspended` is defined at `src/context/AudioContext.js:L135-L143`; it awaits `ctx.resume()`.
- In `playTrack`, `unlockAudioFromGesture` dispatch happens at `L1181` (not awaited), then `await resumeWebAudioContextIfSuspended(...)` at `L1185` occurs before track load/play path.
- This places at least one async boundary before the eventual playback call path.
- Assessment: **Possibly Yes**.

## C — `visibilitychange` and `pagehide`
- Full handlers live in `src/context/AudioContext.js:L2117-L2172` and `L2197-L2210`.
- On visible resume path, handler calls `el.play().catch(() => {})` at `L2159` without gesture context.
- `pagehide` handler persists progress only; no `audio.play()` there.
- Assessment: **Possibly** (can fail to auto-resume on iOS; less likely root cause for first manual tap silence).

## D — Service worker interference
- `public/sw.js` contains only install/activate/message keep-alive handling (`L1-L21`).
- No fetch handler, no stream interception, no cache logic, no `/api/library/stream` handling.
- Assessment: **No** (not intercepting audio requests).

## E — `crossOrigin` and `playsInline`
- Audio element in `src/context/AudioContext.js:L2397-L2404` includes both `playsInline` (`L2400`) and `crossOrigin="anonymous"` (`L2401`).
- Assessment: **No** (required attributes present).

## F — `muted` / autoplay
- Main `<audio>` element does not set `muted` and does not set `autoPlay` (`src/context/AudioContext.js:L2397-L2404`).
- Playback is initiated via explicit play calls (gesture-driven paths), not passive autoplay attributes.
- Assessment: **No clear regression signal** from muted/autoplay attributes in current code.
