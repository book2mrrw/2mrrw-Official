# Phase 5.2.7 — Timing Waterfall Reference

**Method:** Code-path analysis + Phase 5.2.4/5.2.5/5.2.6 baselines + quick curl probe (2026-05-31).  
**Live browser waterfall:** Requires `npm run dev` + `window.dumpPlaybackTiming()` (not captured in this phase).

---

## Ordered stages (dev marks)

| # | Stage | Mark | Typical offset from tap (guest preview, cold) |
|---|-------|------|-----------------------------------------------|
| 0 | User tap | `PLAYBACK_TAP` | 0 ms |
| 1 | Serial queue dequeue | `PLAYBACK_QUEUE_RESOLVED` | 1–5 ms |
| 2 | playTrackInternal entry | `PLAYBACK_REQUEST` | 2–8 ms |
| 3 | Web Audio init/resume | (snapshot only) | 3–15 ms |
| 4 | Resolver (if entitled signed path) | `PLAYBACK_RESOLVER_*` | 170–580 ms |
| 5 | Signed URL HEAD | `PLAYBACK_SIGNED_URL` | +50–150 ms |
| 6 | audio.src assign + load | `PLAYBACK_SRC_ASSIGN` | 180–650 ms |
| 7 | loadedmetadata | `PLAYBACK_LOADEDMETADATA` | +20–120 ms |
| 8 | loadeddata | `PLAYBACK_LOADEDDATA` | +10–80 ms |
| 9 | canplay (readyState ≥ 2 exit) | `PLAYBACK_CANPLAY` | +0–50 ms |
| 10 | canplaythrough | `PLAYBACK_CANPLAYTHROUGH` | +0–200 ms |
| 11 | audio.play() call | `PLAYBACK_AUDIO_PLAY_CALL` | +1–5 ms |
| 12 | play() promise resolved | `PLAYBACK_PLAY_PROMISE_RESOLVED` | +1–20 ms |
| 13 | playing → audible | `PLAYBACK_AUDIBLE` | +0–30 ms |

**Headline measure:** `playback-tap-to-audible` = sum of present stages.

---

## Example formatted waterfall (synthetic — guest preview, redirect path)

```
     0.0 ms  Tap (playTrack/playQueue)
     2.1 ms  Queue resolution
     4.8 ms  playTrackInternal start
   198.3 ms  audio.src assignment
   245.7 ms  loadedmetadata
   312.4 ms  loadeddata
   318.9 ms  canplay
   421.2 ms  canplaythrough
   422.0 ms  audio.play() call
   425.3 ms  play() promise resolved
   431.8 ms  First audible frame (playing)
```

Resolver stages absent on redirect/preview path. Values illustrative — run dev dump for real numbers.

---

## Segment measures (interpretation)

| Measure | What it isolates | Typical cold preview |
|---------|------------------|----------------------|
| `playback-tap-to-queue` | React dispatch + serial queue | 1–5 ms |
| `playback-queue-to-request` | Command handler entry | 1–5 ms |
| `playback-resolver` | `/api/library/stream` JSON | 170–580 ms (when present) |
| `playback-signed-url` | HEAD validation | 50–150 ms (when present) |
| `playback-src-to-loadedmetadata` | Network + demux start | 80–250 ms |
| `playback-loadedmetadata-to-loadeddata` | Decode buffer fill | 40–180 ms |
| `playback-loadeddata-to-canplay` | ReadyState promotion | 0–50 ms |
| `playback-play-call-to-promise` | Autoplay policy / thread | 1–20 ms |
| `playback-promise-to-audible` | Output buffer → speaker | 0–30 ms |
| `playback-tap-to-audible` | **End-to-end** | **320–830 ms** (post-5.2.6 prewarm) |

---

## Same-src fast path (repeat play)

When `normalizePlaybackSrc(audio.src) === new src` and `readyState >= 2`:

- `PLAYBACK_SRC_ASSIGN` + `PLAYBACK_CANPLAY` fire immediately in `waitAudioSrcReady`
- Skips network/decode wait
- **Expected `playback-tap-to-audible`:** 50–200 ms

Verify with two taps on same card without hard refresh.

---

## Element events correlation

During decode-heavy segments, expect:

| Event | Meaning |
|-------|---------|
| `networkState-change` → NETWORK_LOADING | Fetch started |
| `progress` | Bytes arriving |
| `readyState-change` → HAVE_METADATA | After loadedmetadata |
| `readyState-change` → HAVE_CURRENT_DATA | After loadeddata |
| `waiting` / `stalled` | Buffer underrun — adds gap before canplay |
| `suspend` | Browser paused fetch (background tab) |

Compare `elementEvents[].offsetFromTapMs` with waterfall gaps to pinpoint buffer stalls vs decode.

---

## Quick probe (2026-05-31, agent curl to prod)

| Endpoint | Time |
|----------|------|
| `GET /api/account/state` | 918 ms (elevated — sandbox RTT; Phase 5.2.4 local curl ~0.2–0.6 ms) |
| `GET /api/library/stream?slug=test&redirect=1` | 1040 ms (includes 404/redirect chain) |

Use Phase 5.2.4 baselines (~215 ms preview redirect) for bottleneck ranking; this probe confirms API remains non-trivial vs client decode.

---

## Validation

Instrumentation verified by:

- Code review of all mark emission sites
- `npm run build` **PASS**
- `dumpPlaybackTiming()` API present at module load in dev

Live numeric waterfall: **operator action required** (see `methodology.md`).
