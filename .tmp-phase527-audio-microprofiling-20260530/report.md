# Phase 5.2.7 — Audio Decode Micro-Profiling

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Baseline:** commit `82aeeb0` (+ unstaged instrumentation)  
**Hybrid flags:** OFF (unchanged)  
**Zip:** `/Users/recharge/Downloads/phase527-audio-microprofiling-20260530.zip`

---

## Executive summary

Phase 5.2.7 adds **dev-only micro-profiling** across the full tap → audible playback pipeline. No production behavior changes, no optimizations, no entitlement or streaming architecture edits.

1. **Extended `performanceMarks.js`** — 14-stage waterfall, 21 derived measures, `<audio>` element telemetry ring buffer (readyState/networkState, stalled/waiting/suspend/progress), Web Audio context snapshots, `resetPlaybackTimingCapture()` on each tap.
2. **AudioContext dev hooks** — `attachPlaybackElementDevTelemetry`, `recordAudioContextState` at gesture unlock / initWebAudio / playTrack, `play()` promise marks, auto `dumpPlaybackTiming()` on `playing`.
3. **`window.dumpPlaybackTiming()`** — returns + logs full waterfall with offsets from tap, stage deltas, element events, AudioContext state.
4. **Methodology documented** — desktop Chrome DevTools procedure; iOS Safari / Android Chrome marked **requires-device-run** (not executed in this phase).
5. **TOP 5 bottlenecks ranked** — client decode/network still dominate; command queue and play() promise are minor.

---

## Scope discipline

| In scope | Out of scope |
|----------|--------------|
| Dev-gated Performance API marks | Production logging |
| Element event collection (dev) | Byte prefetch / hybrid flags |
| Waterfall dump helper | Resolver / entitlement changes |
| Documentation + zip deliverables | Browser soak tests (skipped) |

All instrumentation is gated by `process.env.NODE_ENV === "development"` via `canMark()` — **zero prod overhead**.

---

## Files modified

| File | Change |
|------|--------|
| `src/lib/dev/performanceMarks.js` | Full pipeline marks, waterfall builder, `dumpPlaybackTiming()`, `attachPlaybackElementDevTelemetry()`, `recordAudioContextState()`, `resetPlaybackTimingCapture()` |
| `src/context/AudioContext.js` | Wire telemetry + AudioContext snapshots; `play()` marks; reset capture on tap; `loadeddata` mark in `waitAudioSrcReady` |
| `src/lib/playback/stream-client.js` | Resolver marks (unchanged this phase — already present) |

---

## Dev verification (quick)

```bash
npm run dev
# Chrome → localhost:3000 → tap play on a release card
# Console:
window.dumpPlaybackTiming()
```

Expected: `totalTapToAudibleMs`, `waterfall[]` with 10–14 present stages, `elementEvents[]` with readyState/networkState transitions.

---

## Validation

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| Long browser soak | **Skipped** — methodology in `methodology.md` |
| iOS / Android device run | **Requires device** — documented, not executed |

---

## TOP 5 bottlenecks (summary)

See `bottleneck-ranking.md` for full table.

| Rank | Bottleneck | Est. share (guest preview, cold) |
|------|------------|----------------------------------|
| 1 | **Client decode + `waitAudioSrcReady`** | **150–500 ms** (up to ~800 ms cold) |
| 2 | **Stream/preview API + CDN first byte** | **170–580 ms** API + **80–250 ms** CDN |
| 3 | **Cross-track fade (track switch while playing)** | **0–300 ms** (conditional) |
| 4 | **Serial command queue wait** | **1–15 ms** typical |
| 5 | **First-listen volume swell (post-audible)** | **~500 ms perceived** |

---

## STOP

No fixes, optimizations, commit, push, or deploy. Instrumentation only.
