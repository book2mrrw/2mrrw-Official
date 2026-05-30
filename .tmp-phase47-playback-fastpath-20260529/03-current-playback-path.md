# 03 — Current Playback Path

Static analysis of production playback startup as implemented today (post Phase 4.6).

## Entry points

| API | File | Behavior |
|-----|------|----------|
| `playTrack(track)` | `src/context/AudioContext.js` ~2588 | Marks `PLAYBACK_TAP`, serial command |
| `playQueue(...)` | ~2597 | Same tap mark |
| Page / modals | `src/app/page.js`, `src/lib/music-playback.js` | `resolvePlaybackSrc` before dispatch |

## Src resolution (`src/lib/music-access.js`)

1. Offline URL if cached for user+slug
2. If `canRequestLibraryStream` → `libraryStreamRedirectSrc(slug)` → `/api/library/stream?slug=&redirect=1`
3. Else preview CDN via `catalogPreviewAudioUrl(previewPath)`
4. Fallback `track.preview || track.src`

`canRequestLibraryStream` requires `access.canStream`, `userId`, and `accountState.user.id === userId` (cookie-aligned server user).

## Client play (`playTrackInternal`)

**Pre-play work (same for all paths):**

- `unlockAudioFromGesture` — silent play/pause for iOS
- `initWebAudio` + `resumeWebAudioContextIfSuspended`
- `preloadCoverImage`
- `AUDIO_START_LATENCY_START`

**Stream branch (`usesLibraryStream`):**

```javascript
// AudioContext.js ~1516-1524
if (previewSrc && !entitledFullStream) syncSrc = previewSrc;
else if (redirectFastPath) syncSrc = nextTrack.src;
else if (entitledFullStream) backgroundStreamResolve = true;
```

- **Redirect fast-path:** sets `audio.src` to same-origin stream URL immediately; server does auth + sign + proxy on first byte request.
- **Background resolve:** non-redirect entitled src triggers `fetchLibraryStream` (JSON + HEAD) — slower, used when src lacks `redirect=1`.

## Readiness (`waitAudioSrcReady`)

- Timeout: `AUDIO_SRC_READY_TIMEOUT_MS` (12s)
- Marks: `PLAYBACK_SRC_ASSIGN`, `PLAYBACK_FIRST_BYTE` (loadeddata), `PLAYBACK_CANPLAY`
- Invokes `audio.load()` after src assign

## Completion

`onPlaying` → `PLAYBACK_AUDIBLE`, `AUDIO_START_LATENCY_END`, `dumpPlaybackTiming()` (dev only).

## Stream client (`src/lib/playback/stream-client.js`)

- `fetchLibraryStream`: marks resolver start/end; `assertSignedAudioUrl` HEAD after JSON
- `isLibraryStreamRedirectSrc`: detects `redirect=1` to skip client prefetch

## Server (`src/app/api/library/stream/route.js`)

- `redirect=1` → `proxySignedR2Get` (no JSON body)
- else → JSON with `url: libraryStreamRedirectSrc(...)` (proxy URL for client)
- Auth: fan session or guest user required (401 without)

## Observability gap

`performanceMarks.js` gates on `NODE_ENV === "development"`. Production has no tap→audible telemetry; `reportPlaybackDiagnostic` exists but is not aggregated.

## Fast-path status

| Design intent | Implemented? |
|---------------|--------------|
| Entitled play avoids JSON+HEAD on client | **Yes** via `redirect=1` |
| Same-origin Range-safe proxy | **Yes** `proxySignedR2Get` |
| Preview bypasses stream API | **Yes** CDN direct |
| Dev stage breakdown | **Yes** localhost only |
| Server stage breakdown | **No** |
