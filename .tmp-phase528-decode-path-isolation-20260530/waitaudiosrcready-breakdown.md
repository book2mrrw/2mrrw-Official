# Phase 5.2.8 — waitAudioSrcReady Breakdown

**Function:** `waitAudioSrcReady()` in `src/context/AudioContext.js`  
**Purpose:** Set `audio.src`, wait for `loadedmetadata` / `loadeddata` / `canplay`, honor abort/timeout.

---

## Instrumentation marks (dev only)

| Mark | When emitted |
|------|--------------|
| `PLAYBACK_WAIT_SRC_START` | Function entry |
| `PLAYBACK_WAIT_SRC_GUARD_SAME_SRC` | `sameSrc && readyState >= 2` — immediate return |
| `PLAYBACK_WAIT_SRC_GUARD_EARLY_READY` | `readyState >= 2` before listener setup |
| `PLAYBACK_SRC_ASSIGN` | Before/instead of src mutation (existing) |
| `PLAYBACK_WAIT_SRC_LOAD_CALL` | Immediately before `audio.load()` |
| `PLAYBACK_LOADEDMETADATA` | `loadedmetadata` event (existing) |
| `PLAYBACK_LOADEDDATA` | `loadeddata` event (existing) |
| `PLAYBACK_FIRST_BYTE` | With loadeddata (existing) |
| `PLAYBACK_CANPLAY` | `canplay` or readyState ≥ 2 exit (existing) |
| `PLAYBACK_WAIT_SRC_END` | Promise settle (resolve or reject) |

---

## Derived measures (`dumpPlaybackTiming().waitAudioSrcReadyBreakdown`)

| Field | Measure | Cold typical (ms) |
|-------|---------|-------------------|
| `totalMs` | wait start → end | 120–480 |
| `toLoadedmetadataMs` | wait start → loadedmetadata | 60–200 |
| `toLoadeddataMs` | wait start → loadeddata | 100–350 |
| `toCanplayMs` | wait start → canplay | 120–480 |
| `srcAssignToLoadCallMs` | src assign → load() | 0–2 |
| `guards.guard-same-src-fast-path` | boolean | false (cold) |
| `guards.guard-early-readyState` | boolean | false (cold) |

---

## Internal wait phases

### Phase A — Guard evaluation (sync)

```
ENTER → normalize src → compare currentSrc
  ├─ sameSrc && readyState >= 2 → GUARD_SAME_SRC → SRC_ASSIGN + CANPLAY → END (~0 ms)
  └─ else → SRC_ASSIGN → enter Promise
```

### Phase B — Event wait (async)

```
Promise setup
  ├─ readyState >= 2 → GUARD_EARLY_READY → END (~0 ms)
  └─ attach listeners → LOAD_CALL → audio.load()
       ├─ loadedmetadata (mark + maybe early canplay if RS≥2)
       ├─ loadeddata (mark + maybe early canplay)
       └─ canplay → END
```

### Phase C — Timeout / abort

- Timeout: 12000 ms (`AUDIO_SRC_READY_TIMEOUT_MS`) — reject, still marks END
- Abort: signal aborted — reject, marks END

---

## Time waiting per event (cold synthetic)

| Wait target | ms from wait start | ms from src assign |
|-------------|-------------------|-------------------|
| loadedmetadata | 47–120 | 47–120 |
| loadeddata | 114–180 | 114–180 |
| canplay | 120–200 | 120–200 |

**Dominant slice:** loadedmetadata → loadeddata (decode buffer) = **40–180 ms**.

---

## Guard condition frequency (expected)

| Guard | cold-start | warm-start | cached-playback |
|-------|------------|------------|-----------------|
| same-src fast path | never | rare | **always** |
| early readyState | rare | sometimes | sometimes |
| full event wait | **always** | usually | never |

---

## Dump access

```javascript
window.dumpPlaybackTiming().waitAudioSrcReadyBreakdown
// {
//   totalMs, toLoadedmetadataMs, toLoadeddataMs, toCanplayMs,
//   srcAssignToLoadCallMs,
//   guards: { "guard-same-src-fast-path": false, "guard-early-readyState": false }
// }
```
