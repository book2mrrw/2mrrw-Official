# Audit 1: Playback State Machine Integrity

## 1) Confirmed problems
- Dual authority on playback state (`AudioContext` and `useMediaEngine` mapping) creates stale-read windows for controls and UI (`src/context/AudioContext.js`, `src/media/useMediaEngine.js`).
- `playTrack` uses latest-request token (`playRequestIdRef`) but leaves multiple async branches able to write state after source swaps (`src/context/AudioContext.js` around `playTrack`, background signed-url swap, preview fallback).
- `onEnded` uses delayed transition (`setTimeout(finishEnded, 2000)`) while queue/repeat refs remain mutable, enabling end-of-track decisions to run on changed queue topology.
- Pause-interruption suppression (`skipPauseInterruptionRef`) is reused across many flows (stream retry, source swap, stop, CS mode, preview cap), increasing accidental masking of legitimate pause signals.
- Telemetry and stream session lifecycle are not transactionally tied: stream session may be created before signed URL use, and ended via separate async paths (`src/app/api/library/stream/route.js`, `src/lib/playback/stream-pipeline.js`, `src/context/AudioContext.js`).

## 2) Potential future risks
- Incremental feature additions around queue mutation and CS mode increase non-deterministic playback transitions.
- Racey state patching (`patchState`) without event-sourced sequencing can regress under React scheduling changes.

## 3) Race conditions
- **RC-1:** `playTrack` async branch races: background signed URL swap can occur after newer play request unless guarded at every branch (`src/context/AudioContext.js` `requestId` checks are partial).
- **RC-2:** `onEnded` delayed `finishEnded` can run after queue or repeat mutations.
- **RC-3:** `upgradeToFullStream` can swap src while another retry/play is active.

## 4) Mobile-specific risks
- iOS gesture-chain strictness amplifies async boundaries before `audio.play()`.
- Hidden/visible transitions can leave `stateRef.current.isPlaying` and element paused state temporarily divergent.

## 5) App-transition risks
- PWA/standalone mode plus page visibility transitions rely on best-effort resume and metadata rehydrate, not deterministic replay of state machine events.

## 6) Hidden architectural divergence
- Canonical track normalization exists (`normalizeTrackForPlayback`) but some UI actions still issue direct toggles/seek against mapped engine state, not explicit state-machine commands.

## 7) Memory leak risks
- Timers/RAFs are broadly cleaned up, but nested one-off listeners (`loadedmetadata`, `canplay`) are repeatedly attached in many branches; failures can leave latent listeners when branch exits early.

## 8) Hydration/remount risks
- `AudioProvider` mounts hidden audio globally; page/modal remounts manipulate playback entrypoints independently, increasing remount coupling.

## 9) Async-flow instability
- Playback, entitlements refresh, and stream resolution are loosely coupled by custom events and refs, not a single orchestrator.

## 10) Exact file-level remediation recommendations
- Build a formal playback command reducer with monotonic command IDs and immutable transitions:
  - `src/context/AudioContext.js` (state transitions and event handlers)
  - `src/media/useMediaEngine.js` (read-only projection only)
- Replace timeout-based ended handling with atomic next-track resolution:
  - `src/context/AudioContext.js` (`onEnded` block and queue ops)
- Introduce a stream/session coordinator that owns session create/refresh/end lifecycle:
  - `src/app/api/library/stream/route.js`
  - `src/lib/playback/stream-pipeline.js`
  - `src/lib/playback/stream-client.js`
- Convert `skipPauseInterruptionRef` into scoped tokens tied to explicit operations (swap, retry, stop), not a shared boolean:
  - `src/context/AudioContext.js`
- Define invariant tests for state transitions (play->pause->retry->ended queue advance, preview cap, repeat/shuffle interactions):
  - new playback state-machine test module (permanent architecture guardrail).

## 11) Priority (critical/high/medium/low)
- **Critical:** formal command reducer + atomic ended transition.
- **High:** stream/session coordinator + scoped interruption tokens.
- **Medium:** listener hygiene and invariant test harness.
- **Low:** telemetry dedupe harmonization with reducer events.
