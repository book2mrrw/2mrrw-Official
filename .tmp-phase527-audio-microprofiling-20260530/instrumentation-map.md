# Phase 5.2.7 — Instrumentation Map

**Scope:** Dev-only (`NODE_ENV === "development"`). Production builds compile marks away via `canMark()` no-ops.

---

## Pipeline (ordered)

```
Tap → playTrack/playQueue → command queue → playTrackInternal → resolver (optional)
  → src assign → loadedmetadata → loadeddata → canplay → canplaythrough
  → audio.play() → play promise → playing (audible)
```

---

## Performance marks

| Stage | Mark constant | Emitted from |
|-------|---------------|--------------|
| Tap | `PLAYBACK_TAP` | `playTrack`, `playQueue` in `AudioContext.js` |
| Queue resolved | `PLAYBACK_QUEUE_RESOLVED` | `dispatchPlaybackCommand` → `run()` when serial queue dequeues |
| playTrackInternal | `PLAYBACK_REQUEST` | Start of `playTrackInternal` |
| Resolver start | `PLAYBACK_RESOLVER_START` | `fetchLibraryStream()` in `stream-client.js` |
| Resolver end | `PLAYBACK_RESOLVER_END` | After JSON body parsed in `fetchLibraryStream` |
| Signed URL validated | `PLAYBACK_SIGNED_URL` | After HEAD on signed URL in `fetchLibraryStream` |
| src assign | `PLAYBACK_SRC_ASSIGN` | `waitAudioSrcReady` (same-src fast path or new assignment) |
| loadedmetadata | `PLAYBACK_LOADEDMETADATA` | `waitAudioSrcReady` listener + `attachPlaybackElementDevTelemetry` |
| loadeddata | `PLAYBACK_LOADEDDATA` | `waitAudioSrcReady` + element telemetry |
| First byte (legacy) | `PLAYBACK_FIRST_BYTE` | `waitAudioSrcReady` on `loadeddata` |
| canplay | `PLAYBACK_CANPLAY` | `waitAudioSrcReady` onReady + element telemetry |
| canplaythrough | `PLAYBACK_CANPLAYTHROUGH` | Element `canplaythrough` handler + `onCanPlayThrough` in AudioContext |
| audio.play() call | `PLAYBACK_AUDIO_PLAY_CALL` | `loadAudioSrcAndPlay`, `playAudioIfNotPaused` |
| play() promise resolved | `PLAYBACK_PLAY_PROMISE_RESOLVED` | After `await audio.play()` resolves |
| Audible | `PLAYBACK_AUDIBLE` | `playing` event → triggers `dumpPlaybackTiming()` |

### Init / context marks (supporting)

| Mark | Source |
|------|--------|
| `PLAYBACK_PROVIDER_MOUNT` | `AudioProvider` mount effect |
| `PLAYBACK_AUDIO_ELEMENT_READY` | `<audio>` ref ready effect |
| `HYDRATION_START` / `HYDRATION_END` | `AppAuthRoot.js` (dev) |
| `AUDIO_START_LATENCY_START` | `playTrackInternal` |
| `AUDIO_START_LATENCY_END` | `playing` event |
| `QUEUE_UPDATE_START` / `QUEUE_UPDATE_END` | `setQueue` (queue UI updates) |

---

## Derived measures (`dumpPlaybackTiming`)

| Measure | Start → End |
|---------|-------------|
| `playback-tap-to-queue` | TAP → QUEUE_RESOLVED |
| `playback-queue-to-request` | QUEUE_RESOLVED → REQUEST |
| `playback-tap-to-request` | TAP → REQUEST |
| `playback-request-to-resolver` | REQUEST → RESOLVER_START |
| `playback-resolver` | RESOLVER_START → RESOLVER_END |
| `playback-signed-url` | RESOLVER_END → SIGNED_URL |
| `playback-signed-url-to-src` | SIGNED_URL → SRC_ASSIGN |
| `playback-src-to-loadedmetadata` | SRC_ASSIGN → LOADEDMETADATA |
| `playback-loadedmetadata-to-loadeddata` | LOADEDMETADATA → LOADEDDATA |
| `playback-loadeddata-to-canplay` | LOADEDDATA → CANPLAY |
| `playback-canplay-to-canplaythrough` | CANPLAY → CANPLAYTHROUGH |
| `playback-canplaythrough-to-play-call` | CANPLAYTHROUGH → AUDIO_PLAY_CALL |
| `playback-play-call-to-promise` | AUDIO_PLAY_CALL → PLAY_PROMISE_RESOLVED |
| `playback-promise-to-audible` | PLAY_PROMISE_RESOLVED → AUDIBLE |
| `playback-src-to-first-byte` | SRC_ASSIGN → FIRST_BYTE |
| `playback-first-byte-to-canplay` | FIRST_BYTE → CANPLAY |
| `playback-canplay-to-audible` | CANPLAY → AUDIBLE |
| `playback-tap-to-audible` | TAP → AUDIBLE (headline) |
| `audio-start-latency` | AUDIO_START_LATENCY_START → END |

---

## Element telemetry (`attachPlaybackElementDevTelemetry`)

Ring buffer: `window.__2mrrwPlaybackElementEvents` (max 80 entries).

| Event type | Trigger |
|------------|---------|
| `readyState-change` | Poll on loadedmetadata/loadeddata/canplay/playing |
| `networkState-change` | Poll on state transitions |
| `waiting` | `<audio>` waiting event |
| `stalled` | `<audio>` stalled event |
| `suspend` | `<audio>` suspend event |
| `progress` | `<audio>` progress event |

Each entry includes: `t`, `readyState`, `readyStateLabel`, `networkState`, `networkStateLabel`, `paused`, plus transition `from`/`to`/`reason` where applicable.

---

## Web Audio context snapshots

`recordAudioContextState(ctx, label)` → `window.__2mrrwLastAudioContextState`

| Label | When |
|-------|------|
| `gesture-unlock` | Document gesture unlock handler |
| `ephemeral-unlock` | iOS ephemeral AudioContext probe |
| `initWebAudio` | Web Audio graph created |
| `playTrack-resume` | Before play in `playTrackInternal` |

---

## API surface (dev console)

```javascript
window.dumpPlaybackTiming()           // → { totalTapToAudibleMs, measures, waterfall, stageDurations, formattedWaterfall, elementEvents, audioContextState }
window.__2mrrwLastPlaybackTiming      // last dump result
window.__2mrrwPlaybackElementEvents   // raw element ring buffer
```

`resetPlaybackTimingCapture()` runs automatically on each `playTrack` / `playQueue` tap to isolate single-play waterfalls.
