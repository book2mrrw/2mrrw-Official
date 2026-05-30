# 09 — Playback Readiness Analysis

When does the platform consider audio "ready" vs "audible"? Maps to Performance marks and error surfaces.

## Readiness state machine (`waitAudioSrcReady`)

**File:** `src/context/AudioContext.js` (~118–179)

| State | Trigger | Mark |
|-------|---------|------|
| Src assigned | `audio.src = src` | `PLAYBACK_SRC_ASSIGN` |
| First byte | `loadeddata` | `PLAYBACK_FIRST_BYTE` |
| Can play | `canplay` or `readyState >= 2` via metadata | `PLAYBACK_CANPLAY` |
| Audible | `playing` event | `PLAYBACK_AUDIBLE` |

**Early exit:** If `audio.readyState >= 1` before listeners, resolves immediately (cached src).

**Timeout:** `AUDIO_SRC_READY_TIMEOUT_MS` — rejects with `AUDIO_SRC_READY_TIMEOUT` after 12s.

**Abort:** `AbortSignal` from stream controller cancels in-flight readiness.

## Redirect fast-path readiness

1. `syncSrc` set to `/api/library/stream?slug=&redirect=1`
2. `waitAudioSrcReady` issues GET to same-origin
3. Server must return streamable bytes (200/206) with audio content-type
4. Browser buffers until `canplay`

**No client-side** wait for JSON or signed URL validation on this path.

## JSON path readiness

1. `fetchLibraryStream` completes JSON
2. `assertSignedAudioUrl` HEAD must return audio content-type
3. `audio.src` set to proxy URL from JSON
4. `waitAudioSrcReady` as above

Extra gate: HEAD failure blocks play entirely.

## Play invocation

After `waitAudioSrcReady`, `loadAudioSrcAndPlay` calls `audio.play()`. Failure modes:

- NotAllowedError (autoplay) — mitigated by unlock
- AbortError — superseded request
- Source error — `AUDIO_SRC_INVALID`

## Audible definition

`onPlaying` fires → marks end of `audio-start-latency` and runs `dumpPlaybackTiming()`.

User-perceived "started" may still trail `playing` if volume ramp or CS mode crossfade applies (presentation layer).

## Guest session readiness

`GET /api/guest/session` — **484 ms** warm TTFB this session.

Guest user required for stream route 401 avoidance:

```javascript
// route.js L153-156
const user = await getFanSessionUser() ?? await getGuestUser();
if (!user) return 401;
```

Page load should establish guest session before first entitled stream attempt; otherwise stream fails then preview fallback.

## Readiness vs Phase 4.6 main-thread health

Faster React reconciliation (progress decoupling) improves probability that `canplay` handler runs promptly after network completes — does not replace network readiness time.

## Checklist

| Check | Status |
|-------|--------|
| redirect=1 sets src without JSON | **Pass** (code) |
| waitAudioSrcReady marks fire in order | **Pass** (code) |
| Entitled 200 stream TTFB | **Pending** |
| iOS unlock before play | **Pass** (code) |
| 12s timeout UX | **Pass** (code); long tail |
| Prod readiness telemetry | **Fail** (no marks) |
