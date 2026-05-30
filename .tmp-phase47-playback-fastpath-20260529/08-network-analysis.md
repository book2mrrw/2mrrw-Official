# 08 — Network Analysis

Production probes against https://www.2mrrw.com (2026-05-30). See `curl-measurements.txt` for raw curl output.

## Request map by fan state

### Guest (no entitlement)

```
[optional] GET /api/guest/session          200  ~484–7877 ms TTFB
User tap preview
  → audio.src = CDN OR
  → GET /api/media/preview?folder=…        302  ~602 ms
  → GET CDN preview.mp3                    200/206  ~420–954 ms TTFB
```

**Minimum RTTs (direct CDN src):** 0 API + 1 CDN = **1 round trip**  
**Folder-based preview:** 1 API + 1 CDN = **2 round trips**

### Guest tapping entitled track

```
playTrack → may try stream or preview fallback
GET /api/library/stream?redirect=1         401  ~513 ms (no cookie)
  → fallback preview CDN if configured
```

### Entitled fan (session cookie) — not measured live

```
GET /api/library/stream?slug=X&redirect=1  200/206/302
  Server: auth + DB + R2 sign + proxy stream
```

Expected: **1 browser→origin** connection; server makes internal DB/R2 calls (not visible to curl without cookie).

## Comparative API latency (this session, TTFB ms)

| Endpoint | hour-glass | love-hz-vol-1 |
|----------|------------|---------------|
| JSON stream | 451 | 279 |
| redirect stream | 513 | 804 |

Redirect is not consistently faster than JSON on 401 — both pay auth/session resolution. Entitled 200 may differ when proxy streams immediately.

## CDN behavior (hourglass-preview.mp3)

| Method | HTTP | TTFB ms | Total ms | Size |
|--------|------|---------|----------|------|
| HEAD | 200 | 7846 | 7846 | 0 |
| Range 0–65535 | 206 | 954 | 1027 | 65536 |
| GET full | 200 | 420 | 2131 | 831656 |

**Findings:**

- Range requests work with `Range: bytes=0-65535` header (curl `-r` alone returned 400).
- HEAD can be dramatically slower than GET/range (cold connection / CDN behavior).
- Avoid relying on HEAD for latency-critical probes on refresh path.

## Waterfall vs Phase 4.5 audit

| Metric | Phase 4.5 (prior curl) | Phase 4.7 |
|--------|------------------------|-----------|
| guest/session | 716 ms | 484 ms warm / 7877 ms cold |
| preview 302 | 493 ms | 602 ms |
| stream JSON 401 | 686–813 ms | 279–451 ms |
| stream redirect 401 | 1626 ms | 513–804 ms |

Treat as **regional/variance band**, not regression signal.

## Connection reuse

Warm second `guest/session` (484 ms vs 7877 ms) shows TLS/DNS amortization matters for first navigation of session. Playback after initial page load likely hits warm connections to `www.2mrrw.com`.

## Service worker

`public/sw.js` keep-alive ping (20s) — minimal overhead; does not intercept stream API per prior audits.

## Recommendations (network-only)

1. Prefer direct CDN preview URLs in catalog payloads (skip preview API).
2. Never block play on preview HEAD; redirect path already skips client HEAD.
3. Add `Server-Timing` on stream route for entitled diagnosis.
4. Use Range on audio element (browser default for MP3) — verify proxy supports Range (implemented via `proxySignedR2Get`).
