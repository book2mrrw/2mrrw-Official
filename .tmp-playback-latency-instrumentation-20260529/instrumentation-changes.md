# Instrumentation changes (dev-only)

## Summary

Eight Performance API marks cover the tap→audible pipeline. `dumpPlaybackTiming()` emits seven stage intervals plus end-to-end totals on the `playing` event. No playback architecture, resolver logic, or route behavior was changed.

## `src/lib/dev/performanceMarks.js`

| Mark constant | Performance name | Stage |
|---------------|------------------|-------|
| `PLAYBACK_TAP` | `2mrrw:playback-tap` | User invokes `playTrack` / `playQueue` |
| `PLAYBACK_REQUEST` | `2mrrw:playback-request` | `playTrackInternal` starts |
| `PLAYBACK_RESOLVER_START` | `2mrrw:playback-resolver-start` | `fetchLibraryStream` begins |
| `PLAYBACK_RESOLVER_END` | `2mrrw:playback-resolver-end` | JSON body with `url` received |
| `PLAYBACK_SIGNED_URL` | `2mrrw:playback-signed-url` | HEAD validation on signed CDN URL succeeds |
| `PLAYBACK_SRC_ASSIGN` | `2mrrw:playback-src-assign` | `audio.src` set in `waitAudioSrcReady` |
| `PLAYBACK_FIRST_BYTE` | `2mrrw:playback-first-byte` | `loadeddata` on `<audio>` |
| `PLAYBACK_CANPLAY` | `2mrrw:playback-canplay` | `canplay` / `readyState >= 2` |
| `PLAYBACK_AUDIBLE` | `2mrrw:playback-audible` | `playing` event |

**Measures** (via `dumpPlaybackTiming()`):

1. `playback-tap-to-request`
2. `playback-request-to-resolver`
3. `playback-resolver` (API JSON)
4. `playback-signed-url` (HEAD probe)
5. `playback-signed-url-to-src`
6. `playback-src-to-first-byte`
7. `playback-first-byte-to-canplay`
8. `playback-canplay-to-audible`
9. `playback-tap-to-audible` (E2E)
10. `audio-start-latency` (legacy measure, `AUDIO_START_LATENCY_*`)

**Dev globals:** `window.__2mrrwLastPlaybackTiming`, `window.dumpPlaybackTiming()`.

**Gate:** `process.env.NODE_ENV === "development"` only — production builds are no-ops.

## `src/lib/playback/stream-client.js`

- `perfMark(PLAYBACK_RESOLVER_START)` at `fetchLibraryStream` entry.
- `perfMark(PLAYBACK_RESOLVER_END)` after JSON parse when `body.url` is present.
- `perfMark(PLAYBACK_SIGNED_URL)` after `assertSignedAudioUrl` HEAD succeeds.

Skipped when playback uses redirect fast-path (`?redirect=1`) or direct preview CDN URLs.

## `src/context/AudioContext.js`

- `perfMark(PLAYBACK_TAP)` in `playTrack` / `playQueue` before command queue dispatch.
- `perfMark(PLAYBACK_REQUEST)` at `playTrackInternal` entry.
- `perfMark(PLAYBACK_SRC_ASSIGN)` before `audio.src = src`.
- `loadeddata` → `PLAYBACK_FIRST_BYTE`; `canplay` → `PLAYBACK_CANPLAY`.
- `onPlaying` → `PLAYBACK_AUDIBLE`, `AUDIO_START_LATENCY_END`, `dumpPlaybackTiming()`.

## Paths without full mark coverage

| Path | Resolver marks | Notes |
|------|----------------|-------|
| Preview CDN (`catalogPreviewAudioUrl`) | No | Tap → request → src → byte → canplay → audible |
| Redirect stream (`?redirect=1`) | No | Server resolve inside redirect response |
| Cached stream meta refresh | Partial | May skip resolver if URL still valid |

## Prior failure: `WritableIterable is closed`

Likely caused by streaming zip/archive or browser MCP session teardown mid-write. This deliverable uses `zip -r` on a completed directory after all markdown files are flushed to disk.
