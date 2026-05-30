# 2. All blockers before `audio.play()`

## Hard gates (always on new track / src change)

| Blocker | File | Notes |
|---------|------|-------|
| `waitAudioSrcReady` | AudioContext.js:89–108, 1499 | **Primary.** No `play()` until `canplay`/`canplaythrough`/`error`/3s timeout |
| `loadAudioSrcAndPlay` | AudioContext.js:111–119 | Wraps wait + play |
| Cross-track fade | AudioContext.js:1471–1492 | Up to **300ms** `setInterval` before `loadAudioSrcAndPlay` when switching tracks while playing |
| `audio.pause()` before new src | AudioContext.js:1496–1498 | Same-track resume skips reload |

## Await chain inside `playTrack` (before first `play`)

1. `unlockAudioFromGesture` — if paused (1165–1176, 1179–1181)
2. `resumeWebAudioContextIfSuspended` (1185)
3. Optional fade Promise (1478–1492)
4. `loadAudioSrcAndPlay` → `waitAudioSrcReady` → `audio.play()` (1499)

Same-track branch (1501–1556): may skip reload; only `await audio.play()` if same identity.

## Not blocking first `play()` (but on critical path nearby)

| Item | Blocks play? |
|------|----------------|
| `preloadCoverImage` | No |
| `backgroundStreamResolve` + `swapToSignedStream` | No when `redirect=1` fast path (default entitled) |
| `fetchLibraryStream` on visibility hidden | No (background refresh) |
| `getArtworkEntriesForTrack` in `updateMediaSession` | Called with `void` after play; **`onPlay` also calls `updateMediaSession`** which awaits artwork — runs after play starts but competes for bandwidth |
| `sendControlSystemPlaybackEvent` / `/api/media/playback` | No (`onPlay` handler) |
| `recordLocalListening` | No |
| First-listen volume swell | After play starts |

## Safari / autoplay policy

| Blocker | Mitigation |
|---------|------------|
| User gesture required | `GESTURE_UNLOCK_EVENTS` → `initWebAudio`, ephemeral AudioContext resume (568–614) |
| `unlockAudioFromGesture` silent play/pause | Before `playTrack` (1165–1176) |
| Suspended AudioContext | `resumeWebAudioContextIfSuspended` before play |

## Entitlement / network blockers

| Condition | Behavior |
|-----------|----------|
| No `src` | Early return, error state (1222–1235) |
| Stream 401/403 with `canStream` metadata | Preview fallback via `getTrackPreviewSrc` (async load, not initial play) |
| `ACCESS_DENIED` | `audio.pause()`, no play |
| `CONCURRENT_STREAM` 409 | Conflict UI, no play |
| Offline | `onError` waits for `online` then `playTrack` retry |

## `await` inventory (AudioContext.js)

All `await` before or at play: lines 92, 112–114, 1185, 1478–1499, 1550 (same-track), plus error-retry paths 955–977, 1002.

## Recommendations (plan only)

- Start fetch/range request at tap **before** React state flush (link preload or `audio.src` assign in event handler synchronously).
- Replace fixed 3s `waitAudioSrcReady` timeout with progressive play on `loadeddata` where Safari allows.
- Skip 300ms fade on mobile or when `prefers-reduced-motion`.
- Defer `updateMediaSession` artwork preload until after `playing` + use cached entries only on repeat slugs.
