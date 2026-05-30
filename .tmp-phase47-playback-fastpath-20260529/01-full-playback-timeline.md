# 01 — Full Playback Timeline

Ordered sequence from user tap to audible output, mapped to `performanceMarks.js` and source anchors.

## Timeline (all paths)

```
[T0] User tap
  │  perfMark(PLAYBACK_TAP) — AudioContext playTrack / playQueue
  ▼
[T1] Command queue serial drain
  │  dispatchPlaybackCommand(PLAY_TRACK)
  │  Measure: playback-tap-to-request
  ▼
[T2] playTrackInternal starts
  │  perfMark(PLAYBACK_REQUEST)
  │  abort prior stream; unlockAudioFromGesture; initWebAudio; resumeWebAudioContext
  │  preloadCoverImage (parallel, non-blocking)
  │  perfMark(AUDIO_START_LATENCY_START)
  │  Measure: playback-request-to-resolver
  ▼
[T3] Src resolution (branch)
  ├─ A) Entitled: resolvePlaybackSrc → libraryStreamRedirectSrc (?redirect=1)
  ├─ B) Preview: catalogPreviewAudioUrl (CDN)
  └─ C) Legacy JSON: fetchLibraryStream + HEAD (refresh / non-redirect only)
  ▼
[T4] waitAudioSrcReady
  │  perfMark(PLAYBACK_SRC_ASSIGN) → audio.src = syncSrc; audio.load()
  │  loadeddata → perfMark(PLAYBACK_FIRST_BYTE)
  │  canplay → perfMark(PLAYBACK_CANPLAY)
  ▼
[T5] audio.play() resolves
  ▼
[T6] playing event
  │  perfMark(PLAYBACK_AUDIBLE)
  │  perfMark(AUDIO_START_LATENCY_END)
  │  dumpPlaybackTiming()
```

## Path A — Entitled full stream (primary fast-path)

| Step | Component | File | Marks |
|------|-----------|------|-------|
| Tap | `playTrack` | `src/context/AudioContext.js` ~2588 | `PLAYBACK_TAP` |
| Queue | `dispatchPlaybackCommand` | same ~2488+ | tap→request |
| Request | `playTrackInternal` | ~1436 | `PLAYBACK_REQUEST`, `AUDIO_START_LATENCY_START` |
| Src | `resolvePlaybackSrc` → `libraryStreamRedirectSrc` | `src/lib/music-access.js` ~224–237 | *(no resolver marks — no client JSON fetch)* |
| Redirect flag | `isLibraryStreamRedirectSrc` → `syncSrc = nextTrack.src` | `AudioContext.js` ~1510–1521 | — |
| Network | Browser GET `/api/library/stream?slug=&redirect=1` | `src/app/api/library/stream/route.js` | Server-only today |
| Server | auth → entitlement → resolvePlaybackKey → sign → `proxySignedR2Get` | route + `resolve-playback-key.js` | **Pending** Server-Timing |
| Ready | `waitAudioSrcReady` | `AudioContext.js` ~118–179 | SRC_ASSIGN → FIRST_BYTE → CANPLAY |
| Audible | `onPlaying` handler | ~903–906 | AUDIBLE, dump |

**Client skips:** `PLAYBACK_RESOLVER_*`, `PLAYBACK_SIGNED_URL` (no `fetchLibraryStream` on happy path).

## Path B — Guest / preview

| Step | Component | Notes |
|------|-----------|-------|
| Src | `catalogPreviewAudioUrl` or preview fallback | Direct R2 CDN URL |
| Optional API | `/api/media/preview?folder=…` | 302 redirect; **602 ms** TTFB live |
| CDN | Range/GET on MP3 | **954 ms** TTFB for first 64 KiB (this session) |
| Marks | Resolver/signed-url measures **null** in dev table | Expected |

## Path C — JSON stream + HEAD (alternate)

| Step | Component | Notes |
|------|-----------|-------|
| Fetch | `fetchLibraryStream` | `stream-client.js` ~122–211 |
| Marks | `PLAYBACK_RESOLVER_START/END` | Spans JSON fetch |
| HEAD | `assertSignedAudioUrl` | Extra RTT before src assign |
| Marks | `PLAYBACK_SIGNED_URL` | Isolates HEAD |
| Used | Visibility refresh, background resolve when not redirect | Not primary tap play |

## Server timeline (redirect=1)

```
GET /api/library/stream?slug=X&redirect=1
  → getFanSessionUser() ?? getGuestUser()     [401 if no session cookie]
  → validateStreamEntitlement (Supabase)
  → resolveProductIdBySlug
  → findActiveStreamSession / clear
  → resolvePlaybackKey (R2 key discovery)
  → createStreamSession + insertStreamEvent
  → getOrCreateStreamSignedUrl
  → proxySignedR2Get (streams bytes, Range-safe)
```

## Phase 4.6 interaction (no playback architecture change)

Progress RAF decoupled from AudioContext provider value — reduces main-thread contention **before** tap and during playback, but does not shorten stream API or CDN segments. See `.tmp-phase46-performance-implementation-20260529/report.md` (A1/A2).

## What was not captured this pass

- Browser `window.__2mrrwLastPlaybackTiming` (requires `NODE_ENV=development` on localhost)
- Entitled 200 stream body TTFB (requires fan session cookie)
- iOS Safari Web Inspector timeline
