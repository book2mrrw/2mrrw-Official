# Phase 4.8 — Validation Results

## Build

```
npm run build
✓ Compiled successfully
✓ Finished TypeScript
Exit code: 0
```

## curl — before (Phase 4.7 production baseline)

Source: `.tmp-phase47-playback-fastpath-20260529/curl-measurements.txt` (2026-05-30T18:22:17Z, https://www.2mrrw.com)

| Endpoint | HTTP | TTFB (s) | Total (s) |
|----------|------|----------|-----------|
| `GET /api/media/preview?folder=previews/singles/hour-glass/` | 302 | **0.602** | 0.602 |
| `GET /api/library/stream?slug=hour-glass&redirect=1` | 401 | **0.513** | 0.513 |
| `GET /api/library/stream?slug=love-hz-vol-1&redirect=1` | 401 | **0.804** | 0.804 |

## curl — after (Phase 4.8 local production build)

Source: `curl-after.txt` (2026-05-30T18:50:06Z, `next start` on 127.0.0.1:3098)

| Endpoint | Pass | HTTP | TTFB (s) | Server-Timing (ms) |
|----------|------|------|----------|-------------------|
| preview hour-glass | cold | 302 | **0.214** | fastpath=0.1, redirect=0, total=0.1 |
| preview hour-glass | warm | 302 | **0.004** | fastpath=0, redirect=0, total=0.1 |
| stream redirect hour-glass | cold | 401 | **0.007** | auth=0.3, total=0.5 |
| stream redirect hour-glass | warm | 401 | **0.003** | auth=0.3, total=0.4 |
| stream redirect love-hz | cold | 401 | **0.011** | auth=0.5, total=0.6 |
| stream redirect love-hz | warm | 401 | **0.009** | auth=0.2, total=0.3 |

### Delta summary (TTFB)

| Endpoint | Before (prod) | After warm (local) | Improvement |
|----------|---------------|-------------------|-------------|
| Preview API | 602 ms | **4 ms** | ~598 ms (−99%) |
| Stream redirect hour-glass | 513 ms | **3 ms** | ~510 ms (−99%) |
| Stream redirect love-hz | 804 ms | **9 ms** | ~795 ms (−99%) |

**Caveats:** Local measurements exclude Vercel edge RTT and cross-region latency. Production deploy required for prod apples-to-apples. Unauthorized (401) stream probes skip entitlement/resolve/sign segments — entitled 200 path needs session cookie validation (pending).

## Server-Timing verification

- `Server-Timing` present on preview and stream routes ✓
- Preview warm path shows `fastpath` + `redirect` only (no R2 list) ✓
- Stream 401 shows `auth` segment only (early exit before entitlement) ✓
- `X-Playback-Timing` JSON emitted in dev/debug builds ✓

## Not run (out of scope / pending deploy)

- Entitled 200 stream TTFB with fan session cookie on staging/prod
- iOS Safari tap→audible with `dumpPlaybackTiming()`
- p95 RUM sampling
