# Phase 5.2.7 — TOP 5 Bottlenecks

**Ranking method:** Code-path dominance + Phase 5.2.4–5.2.6 measured/estimated segments.  
**Ms values:** Estimated ranges from prior phase baselines and mark segment definitions; live dev dump refines per session.

---

## Rank 1 — Client decode + `waitAudioSrcReady`

| Metric | Value |
|--------|-------|
| **Segment** | `PLAYBACK_SRC_ASSIGN` → `PLAYBACK_LOADEDDATA` / `PLAYBACK_CANPLAY` |
| **Measure keys** | `playback-src-to-loadedmetadata`, `playback-loadedmetadata-to-loadeddata`, `playback-loadeddata-to-canplay` |
| **Typical ms (cold preview)** | **150–500 ms** (aggregate decode path) |
| **Worst case** | **600–800 ms** (large MP3, Slow 4G, buffer stalls) |
| **Same-src repeat** | **~0–20 ms** (fast path) |

**Why #1:** Largest contiguous block after tap on guest preview path. Resolver often skipped (redirect/preview URL). Browser must fetch bytes, demux, and reach `HAVE_CURRENT_DATA` before `play()`.

**Evidence:** Phase 5.2.5 identified `canplay` over-wait; still decode-bound at `loadeddata`. Element telemetry `waiting`/`stalled` events correlate here.

**Not fixed this phase** — instrumentation only.

---

## Rank 2 — Stream/preview API + CDN first byte

| Metric | Value |
|--------|-------|
| **Segment** | Tap → first byte at CDN (or same-origin proxy) |
| **Measure keys** | `playback-resolver` (170–580 ms when present), `playback-signed-url` (+50–150 ms), network before `SRC_ASSIGN` |
| **API RTT (Phase 5.2.4 curl)** | Preview redirect **~215 ms**; stream redirect **~174–192 ms** |
| **CDN / proxy first byte** | **80–250 ms** after URL known |
| **Typical ms (entitled signed path)** | **250–730 ms** before src assign |

**Why #2:** On entitled plays, `/api/library/stream` JSON + signed URL HEAD adds serial RTT before element load begins. Guest preview uses redirect fast path — API cost partially hidden in src-assign segment.

**Partial mitigation (5.2.6):** R2 preconnect saves **~40–150 ms** on first CDN connection when card was visible.

**Not fixed this phase.**

---

## Rank 3 — Cross-track fade (conditional)

| Metric | Value |
|--------|-------|
| **Segment** | `playTrackInternal` fade-out when switching tracks while playing |
| **Typical ms** | **0 ms** (same track / paused) |
| **When active** | **Up to ~300 ms** (10 steps × 30 ms, capped by 300 ms timeout) |
| **Mark gap** | Between `PLAYBACK_REQUEST` and `PLAYBACK_SRC_ASSIGN` |

**Why #3:** Intentional UX — volume ramp before pause/src swap. Not on first play or resume. Shows as queue-to-request inflation in waterfall when switching during playback.

**Not fixed this phase.**

---

## Rank 4 — Serial command queue + React dispatch

| Metric | Value |
|--------|-------|
| **Segment** | `PLAYBACK_TAP` → `PLAYBACK_QUEUE_RESOLVED` → `PLAYBACK_REQUEST` |
| **Measure keys** | `playback-tap-to-queue`, `playback-queue-to-request` |
| **Typical ms** | **1–15 ms** |
| **Worst case** | **15–50 ms** if prior command still running (serial queue) |

**Why #4:** Architecturally necessary for playback correctness. Rarely dominates unless queue blocked by slow prior play (watchdog at 15 s).

**Not fixed this phase.**

---

## Rank 5 — First-listen volume swell (post-audible perception)

| Metric | Value |
|--------|-------|
| **Segment** | After `PLAYBACK_AUDIBLE` — volume 0 → 1 ramp |
| **Typical ms** | **~500 ms** (0.1 step × 10 @ 50 ms, Phase 5.2.5) |
| **Mark impact** | None on `playback-tap-to-audible` (audible fires at volume 0) |

**Why #5:** Affects **perceived** loudness, not mark-based latency. User may report "slow start" despite sub-500 ms tap→audible on repeat listens.

**Not fixed this phase.**

---

## Summary table

| Rank | Bottleneck | ms (typical) | Measured how |
|------|------------|--------------|--------------|
| 1 | Client decode + src ready | **150–500** | Dev marks: src → loadeddata/canplay |
| 2 | API + CDN first byte | **170–580** (+ CDN) | curl (5.2.4) + resolver marks |
| 3 | Cross-track fade | **0–300** | Code timing in playTrackInternal |
| 4 | Command queue | **1–15** | Dev marks: tap → request |
| 5 | First-listen swell | **~500 perceived** | Code: setInterval in playTrackInternal |

---

## What instrumentation enables next

With `window.dumpPlaybackTiming()` on device:

1. Confirm rank order per platform (iOS decode often > Android Chrome).
2. Quantify `waiting`/`stalled` frequency → buffer vs decode split.
3. Compare prewarm hit (5.2.6) via smaller tap→request and earlier src-assign offsets.

**No optimizations applied in 5.2.7.**
