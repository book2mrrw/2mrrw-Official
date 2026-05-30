# Mobile Audio Silent Audit — 2026-05-28

## Section 1 — Most recent commits and diffs
(Verbatim outputs captured in `phase1-most-recent-commits-and-diffs.md`.)

## Section 2 — Desktop vs mobile divergence
(Details in `phase2-desktop-vs-mobile-divergence.md`.)

### A — Gesture chain
- Finding: `playTrack` introduces async boundaries (`src/context/AudioContext.js:L1181`, `L1185`) before eventual `audio.play()` paths.
- Is this the regression? **Possibly Yes (most likely category).**
- Exact file/line: `src/context/AudioContext.js:L1178-L1185`, `L111-L115`, `L1500-L1552`.

### B — AudioContext state
- Finding: `resumeWebAudioContextIfSuspended` exists and is awaited (`src/context/AudioContext.js:L135-L143`, `L1185`) after non-awaited unlock kick-off (`L1181`).
- Is this the regression? **Possibly Yes.**
- Exact file/line: `src/context/AudioContext.js:L1165-L1185`.

### C — visibility/pagehide
- Finding: `visibilitychange` visible branch calls `el.play().catch(() => {})` without gesture (`src/context/AudioContext.js:L2159`); `pagehide` only saves position.
- Is this the regression? **Possibly (resume-specific).**
- Exact file/line: `src/context/AudioContext.js:L2117-L2172`, `L2197-L2210`.

### D — Service worker
- Finding: no fetch interception/caching in SW.
- Is this the regression? **No.**
- Exact file/line: `public/sw.js:L1-L21`.

### E — crossOrigin / playsInline
- Finding: both attributes present on `<audio>`.
- Is this the regression? **No.**
- Exact file/line: `src/context/AudioContext.js:L2397-L2404`.

### F — muted / autoplay
- Finding: no `autoPlay`, no `muted` on main audio element; playback is imperative.
- Is this the regression? **No clear evidence.**
- Exact file/line: `src/context/AudioContext.js:L2397-L2404`.

## Section 3 — Full play path trace
(Details in `phase3-play-path-trace.md`.)

### Card play button
`src/components/music/ReleaseCardPlayButton.js:L97` -> `handlePlay` (`L38-L80`) -> `playQueue` (`src/context/AudioContext.js:L1895-L1899`) -> `playTrack` (`L1178+`) -> async boundaries before eventual `audio.play()`.

### Cover art tap -> modal
`src/app/page.js:L1842` -> `openSingleModal` (`L1104-L1136`) -> `void playTrack(...)` (`L1124`) -> same async `playTrack` path.

### Gesture chain break points
- `src/context/AudioContext.js:L1181` non-awaited async unlock call.
- `src/context/AudioContext.js:L1185` awaited resume before any immediate play attempt.
- Additional async fetch/load layers before playback (`L1145+`, `L1337+`, `L1500+`).

## Section 4 — 403/401 fallback current state
(Details in `phase5-401-403-fallback.md`.)

- 403 + entitled user: no preview fallback (correct).
- 401: still preview fallback (correct).
- Could still surface as silence on iOS if fallback `play()` occurs outside valid gesture chain.

## Section 5 — Album slug fix impact on singles/features
(Details in `phase6-album-slug-impact.md`.)

- Album slug logic appears scoped to album helpers (`src/lib/music-playback.js:L100-L146`).
- No direct evidence this introduced single/feature mobile silence.

## Section 6 — Summary: most likely root cause
Most likely root cause is iOS Safari gesture-chain break in the `playTrack` path, where asynchronous operations occur before deterministic playback (`src/context/AudioContext.js:L1181`, `L1185`, then later `audio.play()` in async branches). Desktop browsers often tolerate this timing pattern, while iOS Safari is stricter and can reject or no-op playback when `play()` is no longer directly tied to the originating gesture.

## Section 7 — Confirmed working / not the problem
- Service worker is not intercepting stream/audio requests (`public/sw.js:L1-L21`).
- `<audio>` includes `playsInline` and `crossOrigin="anonymous"` (`src/context/AudioContext.js:L2400-L2401`).
- 403 fallback logic for entitled users is not reverting to preview (`src/context/AudioContext.js:L1262`, `L988`).

## Notes
- Mobile console/device validation was not run in this audit execution (see `phase4-mobile-console-check.md`).
- This run is audit-only and made no product code changes.
