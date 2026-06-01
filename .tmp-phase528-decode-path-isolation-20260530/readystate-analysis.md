# Phase 5.2.8 — readyState / networkState Analysis

**Source:** `attachPlaybackElementDevTelemetry()` + `analyzeReadyStateTelemetry()` in `performanceMarks.js`  
**Output field:** `dumpPlaybackTiming().readyStateAnalysis`

---

## Telemetry collected

### readyState labels

| Value | Label |
|-------|-------|
| 0 | HAVE_NOTHING |
| 1 | HAVE_METADATA |
| 2 | HAVE_CURRENT_DATA |
| 3 | HAVE_FUTURE_DATA |
| 4 | HAVE_ENOUGH_DATA |

### networkState labels

| Value | Label |
|-------|-------|
| 0 | NETWORK_EMPTY |
| 1 | NETWORK_IDLE |
| 2 | NETWORK_LOADING |
| 3 | NETWORK_NO_SOURCE |

### Events recorded

- `readyState-change` — from/to + reason (loadedmetadata, loadeddata, canplay, playing)
- `networkState-change` — from/to + reason
- `waiting` — buffer underrun
- `stalled` — fetch stalled
- `suspend` — browser paused fetch
- `progress` — bytes received

---

## Dwell time computation

On each state transition, elapsed time since previous transition is accumulated into:

- `readyStateDwellMs` — e.g. `{ HAVE_NOTHING: 45.2, HAVE_METADATA: 67.1, HAVE_CURRENT_DATA: 12.0 }`
- `networkStateDwellMs` — e.g. `{ NETWORK_LOADING: 198.5, NETWORK_IDLE: 15.2 }`

Final state dwell extends to last event timestamp in ring buffer (max 80 events).

---

## Cold start — expected pattern (synthetic)

| Phase | readyState | networkState | Typical dwell (ms) |
|-------|------------|--------------|-------------------|
| Pre-src | HAVE_NOTHING | NETWORK_EMPTY | 0–5 |
| After src + load | HAVE_NOTHING | NETWORK_LOADING | 80–200 |
| loadedmetadata | HAVE_METADATA | NETWORK_LOADING | 40–120 |
| loadeddata | HAVE_CURRENT_DATA | NETWORK_IDLE | 5–50 |
| canplay / playing | HAVE_FUTURE_DATA+ | NETWORK_IDLE | remainder |

**Buffering signals (cold):**

| Event | Expected count |
|-------|----------------|
| waiting | 0–1 |
| stalled | 0–1 |
| suspend | 0 (foreground) |
| progress | 3–12 |

---

## Cached playback — expected pattern (synthetic)

| Phase | readyState | networkState |
|-------|------------|--------------|
| Pre-tap | HAVE_CURRENT_DATA+ | NETWORK_IDLE |
| After tap | unchanged | unchanged |

**Buffering signals:** waiting=0, stalled=0 typical.

---

## Correlation with decode segments

| Waterfall gap | readyState transition | networkState |
|---------------|----------------------|--------------|
| src → loadedmetadata | HAVE_NOTHING → HAVE_METADATA | → NETWORK_LOADING |
| loadedmetadata → loadeddata | HAVE_METADATA → HAVE_CURRENT_DATA | NETWORK_LOADING → IDLE |
| loadeddata → canplay | HAVE_CURRENT_DATA → HAVE_FUTURE_DATA | NETWORK_IDLE |
| waiting event in gap | stall in HAVE_METADATA | NETWORK_LOADING |

Compare `elementEvents[].offsetFromTapMs` with `decodePathBreakdown.segments` to pinpoint buffer stalls vs decode.

---

## Dump shape

```javascript
readyStateAnalysis: {
  readyStateDwellMs: { HAVE_NOTHING: 82.1, HAVE_METADATA: 66.7, ... },
  networkStateDwellMs: { NETWORK_LOADING: 195.3, NETWORK_IDLE: 22.0 },
  readyStateTransitions: [{ t, from, to, reason, offsetFromTapMs }, ...],
  networkStateTransitions: [...],
  buffering: { waitingCount, stalledCount, suspendCount, progressCount }
}
```

---

## Extension over Phase 5.2.7

| 5.2.7 | 5.2.8 |
|-------|-------|
| Transition log in ring buffer | **Dwell ms per state** |
| Event counts implicit | **Explicit buffering counts** |
| Manual correlation | **Structured `readyStateAnalysis` in dump** |
