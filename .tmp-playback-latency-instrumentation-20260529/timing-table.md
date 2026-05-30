# Timing table — playback latency

**Capture date:** 2026-05-30  
**Legend:** **Live** = curl or measured API; **Est.** = audit/code-path estimate (browser dev marks not captured — localhost dev unavailable)

## Seven pipeline stages (intervals)

| Stage interval | Desktop Chrome | Mobile Safari 375px | Mobile Chrome | Source |
|----------------|----------------|---------------------|---------------|--------|
| Tap → Play request | Est. 0–5 ms | Est. 0–8 ms | Est. 0–5 ms | Command queue (`dispatchPlaybackCommand`) |
| Play request → Resolver start | Est. 2–40 ms | Est. 5–80 ms | Est. 2–40 ms | `unlockAudioFromGesture`, WebAudio resume |
| Resolver (API JSON) | **Live** 686–813 ms (401) | Est. 150–600 ms entitled | Est. 150–600 ms | curl `library/stream`; entitled needs auth |
| Signed URL (HEAD) | **Live** 711 ms range / 3893 ms HEAD* | Est. +50–200 ms | Est. +50–200 ms | curl CDN; *cold HEAD outlier |
| Signed URL → Src assign | Est. 0–2 ms | Est. 0–2 ms | Est. 0–2 ms | Sync `audio.src` |
| Src → First byte | Est. 100–800 ms | Est. 200–1500 ms | Est. 100–800 ms | Network + codec |
| First byte → Can play | Est. 20–200 ms | Est. 30–400 ms | Est. 20–200 ms | Buffer/decode |
| Can play → Audible | Est. 5–50 ms | Est. 10–80 ms | Est. 5–50 ms | `play()` promise |
| **Tap → Audible (E2E)** | **Est. 300–1200 ms** stream / **150–500 ms** preview | **Est. 400–1800 ms** | **Est. 300–1200 ms** | Phase 4.5 audit `03-audio-start-latency.md` |

## By content type

### Preview MP3 (`hour-glass`)

| Stage | Live (curl) | Est. tap→audible |
|-------|-------------|------------------|
| Preview API 302 | **493 ms** TTFB | — |
| CDN first 64 KiB | **711 ms** total (206) | — |
| Full file follow | **2931 ms** (831 KB) | — |
| Browser E2E | — | **150–500 ms** warm cache |

### Preview WAV (`2-heavy`)

| Stage | Live | Est. |
|-------|------|------|
| Preview API | Not probed (404 on wrong folder in smoke test) | Use `folder=features/2-heavy` on dev |
| E2E | — | **200–700 ms** (larger decode) |

### Full stream — redirect path (entitled)

| Stage | Live | Est. |
|-------|------|------|
| `/api/library/stream?redirect=1` | **1641 ms** TTFB (401 guest) | **80–200 ms** warm, **150–600 ms** cold |
| E2E tap→audible | — | **300–1200 ms** |

### Full stream — JSON + HEAD path

| Stage | Live | Est. |
|-------|------|------|
| Stream JSON | **813 ms** (401) | **150–600 ms** |
| HEAD signed URL | **711–3893 ms** | **50–200 ms** typical |
| Extra vs redirect | +1 RTT serial | **+50–200 ms** mobile |

## Production curl detail (2026-05-30, US egress)

| Endpoint | HTTP | TTFB (ms) | Total (ms) |
|----------|------|-----------|------------|
| `GET /api/guest/session` | 200 | 716 | 718 |
| `GET /api/media/preview?folder=previews/singles/hour-glass/` | 302 | 493 | 493 |
| `HEAD` CDN `hourglass-preview.mp3` | 200 | 3893 | 3893 |
| `GET` CDN range 0–64KiB | 206 | 657 | 711 |
| `GET /api/library/stream?slug=hour-glass` | 401 | 813 | 813 |
| `GET /api/library/stream?slug=love-hz-vol-1` | 401 | 686 | 686 |
| `GET /api/library/stream?slug=hour-glass&redirect=1` | 401 | 1626 | 1627 |

## Dev instrumentation sample (expected shape)

After play on localhost dev, `window.__2mrrwLastPlaybackTiming` resembles:

```json
{
  "playback-tap-to-request": 1.2,
  "playback-request-to-resolver": 18.5,
  "playback-resolver": 245.0,
  "playback-signed-url": 89.3,
  "playback-signed-url-to-src": 0.1,
  "playback-src-to-first-byte": 412.0,
  "playback-first-byte-to-canplay": 45.2,
  "playback-canplay-to-audible": 12.0,
  "playback-tap-to-audible": 823.3,
  "audio-start-latency": 801.0
}
```

Preview-only plays will show `null` for resolver/signed-url measures.
