# Audio Event Map — `<audio>` in AudioProvider

**File:** `src/context/AudioContext.js`  
**Binding:** `useEffect` mounts handlers when `audioRef.current` exists (L1515–1576 cleanup).

---

## Persistent playback listeners (main effect)

| DOM event | Handler | State / side effects |
|-----------|---------|----------------------|
| `play` | `onPlay` L1077 | `isPlaying: true`, `hasStarted: true`, `isBuffering: false`, keep-alive/RAF/position timers, `persistPlayback("play")`, media session playing, listening telemetry |
| `pause` | `onPause` L1096 | `isPlaying: false`, stop timers, `persistPlayback("pause")`, media session paused; if **not** `userPausedRef` → register `canplay` auto-resume listener |
| `timeupdate` | `onTime` L1139 | Progress sync; preview hard-cap fade/pause at 15s; 30s listening milestone |
| `durationchange` | `onDuration` L1188 | `duration` in state |
| `loadedmetadata` | `onDuration` (dup) L1188 | Same as duration |
| `ended` | `onEnded` L1189 | Spurious-ended guard; preview end; stream finalize; queue auto-advance via `playTrackRef` after 2s delay |
| `error` | `onError` L1324 | Stall stop; offline waiter; stream retry + preview fallback; `ACCESS_DENIED` → pause; `streamRetryable` error state |
| `emptied` | `onEmptied` L1507 | Progress reset, `duration: 0` |
| `waiting` | `onWaiting` L1055 | `isBuffering: true`, `startStallRecovery()` |
| `stalled` | `onStalled` L1059 | Same as waiting |
| `playing` | `onPlaying` L1063 | `isBuffering: false`, perf marks audible |
| `canplaythrough` | `onCanPlayThrough` L1071 | `isBuffering: false` |

---

## Window / document listeners (same effect or adjacent)

| Event | Handler | Purpose |
|-------|---------|---------|
| `window` `online` | `onOnline` L1528 | If playing → `retryStreamPlaybackRef` |
| `navigator.mediaDevices` `devicechange` | `onDeviceChange` L1542 | Log route change |

---

## Ephemeral / per-operation listeners

| Event | Where | Purpose |
|-------|-------|---------|
| `canplay`, `loadeddata`, `loadedmetadata`, `error` | `waitAudioSrcReady` L263–267 | Resolve/reject src readiness promise |
| `abort` on `AbortSignal` | L267 | Cancel src wait |
| `canplay` | `onPause` interrupt resume L1135 | Auto-resume after unintended pause |
| `loadedmetadata` | Seek-after-load (multiple) | Restore position after src swap |
| `canplay` once | Mobile cover preload L1739 | Preload cover art |
| `entitlements:updated` | `window` L2303 | Trigger `upgradeToFullStream` when preview + playing |
| `visibilitychange` | `document` L3153 | Save position; refresh stream meta; recover on visible |
| `pageshow` | `window` L3154 | Media session rehydrate |
| `beforeunload` | `window` L3155 | Persist session track |
| `pagehide` | `window` L3156 | Save playback position |
| GESTURE_UNLOCK_EVENTS | `document` capture L928 | Safari audio unlock |

---

## Media Session action handlers (separate effect ~L2970–3037)

| Action | Calls |
|--------|-------|
| `play` | `resume()` |
| `pause` | `pause()` |
| `previoustrack` | `playPrevious()` |
| `nexttrack` | `playNext()` |
| `seekto` | `seek()` |
| `stop` | `stop()` → `stopInternal` |
| `seekbackward` / `seekforward` | `seek()` ± offset |
| `togglemicrophone` | `toggleCSMode()` |

---

## Dev-only

| Hook | File |
|------|------|
| `attachPlaybackElementDevTelemetry` | `src/lib/dev/performanceMarks.js` — attached L1513 |

---

## Non–AudioContext audio (out of scope for global player death)

- `page.js` hero/carousel `<video>` pause L748–756  
- `page.js` ambient refs L1106–1131  
- `vault-audio.js` separate sounds  
- `ImmersivePreviewModal` does **not** own a second music element — uses `useMediaEngine` → same `audioRef`
