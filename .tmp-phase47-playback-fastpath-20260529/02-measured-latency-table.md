# 02 — Measured Latency Table

**Capture:** 2026-05-30T18:22Z UTC (curl from analysis agent egress)  
**Target:** https://www.2mrrw.com  
**Legend:** **Live** = curl this session; **Est.** = code-path / prior audit; **Pending** = needs entitled session or localhost dev marks

## Production curl — this session

| Probe | HTTP | TTFB (ms) | Total (ms) | Notes |
|-------|------|-----------|------------|-------|
| `GET /api/guest/session` (cold DNS) | 200 | 7877 | 7877 | First request; DNS+TLS cold |
| `GET /api/guest/session` (warm) | 200 | 484 | 484 | Second request |
| `GET /api/media/preview?folder=previews/singles/hour-glass/` | 302 | 602 | 602 | Redirect to R2 CDN |
| `GET /api/library/stream?slug=hour-glass` | 401 | 451 | 454 | Guest/unauth JSON path |
| `GET /api/library/stream?slug=love-hz-vol-1` | 401 | 279 | 279 | Faster slug variant |
| `GET /api/library/stream?slug=hour-glass&redirect=1` | 401 | 513 | 513 | Redirect fast-path (auth fail) |
| `GET /api/library/stream?slug=love-hz-vol-1&redirect=1` | 401 | 804 | 804 | Redirect path |
| `HEAD` CDN `hourglass-preview.mp3` | 200 | 7846 | 7846 | Cold CDN connection |
| `GET` CDN `Range: bytes=0-65535` | 206 | 954 | 1027 | First 64 KiB |
| `GET` CDN full preview (~832 KB) | 200 | 420 | 2131 | Full file download |

Raw log: `curl-measurements.txt`

## Prior session reference (2026-05-30 playback instrumentation)

| Probe | TTFB (ms) | Notes |
|-------|-----------|-------|
| guest/session | 716 | US egress, prior curl batch |
| preview 302 | 493 | Same endpoint |
| stream JSON | 686–813 | 401 |
| stream redirect | 1626 | hour-glass 401 outlier |
| CDN HEAD | 3893 | Cold HEAD outlier |
| CDN range | 657 TTFB / 711 total | 206 |

Variance is expected (edge region, TLS session, Vercel cold start). Use **ranges**, not single samples, for planning.

## Dev instrumentation stages (`dumpPlaybackTiming`)

| Measure | Desktop (sample) | Mobile Safari | Source |
|---------|------------------|---------------|--------|
| playback-tap-to-request | Est. 0–5 | Est. 0–8 | Command queue |
| playback-request-to-resolver | Est. 2–40 | Est. 5–80 | unlock + WebAudio resume |
| playback-resolver | **Pending** entitled | **Pending** | `fetchLibraryStream`; 401 curl only |
| playback-signed-url | **Pending** JSON path | **Pending** | `assertSignedAudioUrl` HEAD |
| playback-signed-url-to-src | Est. 0–2 | Est. 0–2 | `audio.src =` |
| playback-src-to-first-byte | Est. 100–800 | Est. 200–1500 | Network + codec |
| playback-first-byte-to-canplay | Est. 20–200 | Est. 30–400 | Buffer/decode |
| playback-canplay-to-audible | Est. 5–50 | Est. 10–80 | `play()` |
| playback-tap-to-audible | **Pending** | **Pending** | Needs localhost dev |
| audio-start-latency | **Pending** | **Pending** | `onPlaying` marks |

Sample shape from instrumentation doc (localhost dev, not re-captured this pass):

```json
{
  "playback-tap-to-request": 1.2,
  "playback-request-to-resolver": 18.5,
  "playback-resolver": 245.0,
  "playback-signed-url": 89.3,
  "playback-src-to-first-byte": 412.0,
  "playback-first-byte-to-canplay": 45.2,
  "playback-canplay-to-audible": 12.0,
  "playback-tap-to-audible": 823.3
}
```

## By playback mode

| Mode | Dominant live segment | Est. tap→audible |
|------|----------------------|------------------|
| Guest preview (hour-glass) | Preview API 602 ms + CDN range 954 ms | 150–500 ms warm browser cache |
| Entitled redirect stream | Stream API 279–804 ms (401 proxy); entitled **Pending** | 300–1200 ms (Phase 4.5) |
| JSON + HEAD refresh path | Stream JSON + serial HEAD **Pending** with cookie | +50–200 ms vs redirect |

## Measurement scorecard

| Category | Measured | Pending |
|----------|----------|---------|
| Production API probes (curl) | **7** | 1 (entitled 200 stream) |
| CDN byte probes | **2** | 0 |
| Browser Performance marks (9 stages) | **0** | **9** |
| Mobile Safari tap→audible | **0** | **1** |
| **Total checkpoints** | **9** | **11** |

**Ratio:** 9 measured / 11 pending (45% complete for full fast-path validation).
