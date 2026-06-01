# Phase 5.2.8 — Instrumentation Changes

**Scope:** Dev-only decode path isolation. No playback behavior changes.

---

## `src/lib/dev/performanceMarks.js`

### New marks

| Mark | Purpose |
|------|---------|
| `PLAYBACK_WAIT_SRC_START` | `waitAudioSrcReady` entry |
| `PLAYBACK_WAIT_SRC_END` | `waitAudioSrcReady` exit |
| `PLAYBACK_WAIT_SRC_GUARD_SAME_SRC` | Same-src + readyState ≥ 2 fast path |
| `PLAYBACK_WAIT_SRC_GUARD_EARLY_READY` | readyState ≥ 2 before listeners |
| `PLAYBACK_WAIT_SRC_LOAD_CALL` | Before `audio.load()` |

### New exports

- `PLAYBACK_SCENARIOS` — scenario label constants
- `setPlaybackScenario(label, meta)` — tag current capture
- `getPlaybackScenario()` — read active scenario

### New measures

- `playback-wait-src-total`
- `playback-wait-src-to-metadata`
- `playback-wait-src-to-loadeddata`
- `playback-wait-src-to-canplay`
- `playback-wait-src-assign-to-load`
- `playback-canplay-to-play-call` (decode isolation segment)

### Extended `dumpPlaybackTiming()` output

| Field | Description |
|-------|-------------|
| `scenario` | Label from tap (e.g. `cold-start`) |
| `scenarioMeta` | Inference metadata |
| `decodePathBreakdown.segments` | Six decode sub-segments + sum |
| `waitAudioSrcReadyBreakdown` | Total, per-event waits, guards |
| `readyStateAnalysis` | Dwell times, transitions, buffering counts |

### Helpers added

- `analyzeReadyStateTelemetry()` — dwell + transition summary
- `buildWaitAudioSrcReadyBreakdown()`
- `buildDecodePathBreakdown()`

### Reset

`resetPlaybackTimingCapture()` now clears `__2mrrwPlaybackScenario` and dwell state.

---

## `src/context/AudioContext.js`

### `inferPlaybackScenario()`

Infers scenario at tap from:

- Command type (PLAY_TRACK, PLAY_QUEUE, NEXT_TRACK, COMPLETE)
- `hasStarted`, `isPlaying`, current vs next track
- Same-src + readyState for cached-playback

### `waitAudioSrcReady()`

- Wraps with START/END marks
- Marks guard paths and load() call
- No logic change to resolve/reject behavior

### Tap sites

| Entry | Scenario handling |
|-------|-------------------|
| `playTrack()` | infer + `setPlaybackScenario` + TAP mark |
| `playQueue()` | infer (album-tracklist when queue > 1) |
| `playNext()` | `track-skip` + TAP mark |
| `ended` auto-advance | `queue-auto-advance` + reset + TAP mark |

### Unchanged

- Production code paths
- Hybrid streaming flags
- Entitlement / resolver logic
- Cross-track fade timing

---

## Dev verification

```bash
npm run dev
# Tap play → console auto-groups:
# [perf] playback timing — scenario: cold-start
window.dumpPlaybackTiming()
```

Expected new fields: `decodePathBreakdown`, `waitAudioSrcReadyBreakdown`, `readyStateAnalysis`, `scenario`.

---

## Build

```bash
npm run build  # PASS (2026-05-31)
```
