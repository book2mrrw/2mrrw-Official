# Phase 5.2.8 — Scenario Waterfalls

**Format:** Tap / Resolver / src / loadedmetadata / loadeddata / canplay / play / audible (offset ms from tap)  
**Legend:** Values marked **synthetic** from Phase 5.2.7 baselines + code-path analysis. **measured** requires `window.dumpPlaybackTiming()` on device.

---

## Methodology

1. `npm run dev` (NODE_ENV=development).
2. Prime gesture unlock (one tap on page).
3. Execute scenario; on `playing`, auto-dump runs or call `window.dumpPlaybackTiming()`.
4. Read `scenario`, `waterfall[]`, `decodePathBreakdown.segments`.

---

## 1. Cold start (first play after load)

**Trigger:** `playTrack` / release card when `hasStarted === false`  
**Scenario label:** `cold-start`

| Stage | Offset (ms) | Source |
|-------|-------------|--------|
| Tap | 0.0 | synthetic |
| Queue resolved | 2.1 | synthetic |
| playTrackInternal | 4.8 | synthetic |
| Resolver (if entitled) | 180–650 | synthetic — absent on guest preview |
| src assign | 198.3 | synthetic |
| loadedmetadata | 245.7 | synthetic |
| loadeddata | 312.4 | synthetic |
| canplay | 318.9 | synthetic |
| audio.play() | 422.0 | synthetic |
| play promise | 425.3 | synthetic |
| audible | 431.8 | synthetic |

**E2E tap→audible:** ~430 ms (guest preview redirect path, synthetic)

---

## 2. Warm start (second play same source)

**Trigger:** Re-tap same track; src matches but `readyState < 2` or reload needed  
**Scenario label:** `warm-start`

| Stage | Offset (ms) | Source |
|-------|-------------|--------|
| Tap | 0.0 | synthetic |
| src assign | 12.5 | synthetic |
| loadedmetadata | 45.2 | synthetic |
| loadeddata | 98.7 | synthetic |
| canplay | 105.1 | synthetic |
| play() | 108.0 | synthetic |
| audible | 115.4 | synthetic |

**E2E:** ~115 ms (synthetic — partial cache, no full network fetch)

---

## 3. Cached playback

**Trigger:** `sameSrc && readyState >= 2` in `waitAudioSrcReady`  
**Scenario label:** `cached-playback`  
**Guards:** `guard-same-src-fast-path: true`

| Stage | Offset (ms) | Source |
|-------|-------------|--------|
| Tap | 0.0 | synthetic |
| src assign + canplay (immediate) | 8.2 | synthetic |
| play() | 52.0 | synthetic |
| audible | 58.6 | synthetic |

**E2E:** ~60 ms (synthetic — skips decode wait entirely)

---

## 4. Track skip A→B

**Trigger:** `playNext()` or `playTrack(B)` while A playing  
**Scenario label:** `track-skip`

| Stage | Offset (ms) | Source |
|-------|-------------|--------|
| Tap | 0.0 | synthetic |
| Cross-track fade (if playing) | 0–300 | synthetic — conditional |
| src assign (new URL) | 210.0 | synthetic |
| loadedmetadata | 268.4 | synthetic |
| loadeddata | 335.1 | synthetic |
| canplay | 342.0 | synthetic |
| play() | 348.5 | synthetic |
| audible | 355.2 | synthetic |

**E2E:** ~355 ms + fade (synthetic)

---

## 5. Album tracklist selection

**Trigger:** `playQueue(tracks, index)` with `tracks.length > 1`  
**Scenario label:** `album-tracklist`

| Stage | Offset (ms) | Source |
|-------|-------------|--------|
| Tap | 0.0 | synthetic |
| Queue setup | 3.5 | synthetic |
| src assign | 205.0 | synthetic |
| loadedmetadata | 252.0 | synthetic |
| loadeddata | 318.0 | synthetic |
| canplay | 325.0 | synthetic |
| play() | 330.0 | synthetic |
| audible | 338.0 | synthetic |

Same decode shape as cold start; queue length tagged in `scenarioMeta.queueLength`.

---

## 6. Queue auto-advance

**Trigger:** `ended` handler → `playTrackRef(nextTrack)` after 2 s gap  
**Scenario label:** `queue-auto-advance`

| Stage | Offset (ms) | Source |
|-------|-------------|--------|
| Tap (auto) | 0.0 | synthetic |
| src assign | 195.0 | synthetic |
| loadedmetadata | 240.0 | synthetic |
| loadeddata | 305.0 | synthetic |
| canplay | 312.0 | synthetic |
| play() | 318.0 | synthetic |
| audible | 326.0 | synthetic |

Note: 2 s `setTimeout` before advance is **outside** tap→audible window; tap mark fires at auto-advance start only.

---

## Operator capture template

```javascript
copy(JSON.stringify({
  scenario: window.__2mrrwLastPlaybackTiming?.scenario,
  total: window.__2mrrwLastPlaybackTiming?.totalTapToAudibleMs,
  decode: window.__2mrrwLastPlaybackTiming?.decodePathBreakdown?.segments,
  waterfall: window.__2mrrwLastPlaybackTiming?.formattedWaterfall,
}, null, 2))
```
