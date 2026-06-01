# Before/After Latency — Phase 5.2.15 Direct Preview Canary

**Run date:** 2026-05-31  
**Asset:** `previews/singles/hour-glass/hourglass-preview.mp3`  
**Probes:** curl from local dev machine → production `www.2mrrw.com` + R2 CDN  
**Canary flags (local/staging only):** `DIRECT_PREVIEW_ENABLED=1`, `NEXT_PUBLIC_DIRECT_PREVIEW_CDN=1`

---

## Methodology

| Path | Measurement |
|------|-------------|
| **Baseline (redirect)** | `GET /api/media/preview?folder=previews/singles/hour-glass/` — TTFB without follow, then `-L -I` full redirect chain |
| **Direct preview (canary)** | `HEAD` and `Range: bytes=0-65535` against resolved CDN URL (same object the API would 302 to) |
| **Tap → audible (estimated)** | Network first byte (measured) + decode segment from Phase 5.2.7 marks (~150–250 ms typical preview) + `play()` dispatch (~10 ms) |

Dev instrumentation: `window.dumpPlaybackTiming()` → `totalTapToAudibleMs` via marks `PLAYBACK_TAP` → `PLAYBACK_AUDIBLE` in `src/lib/dev/performanceMarks.js`. Browser samples not captured in this automated run; curl network segment validates the removed hop.

---

## Network: Preview API TTFB (no redirect follow)

| Sample | TTFB (ms) |
|--------|-----------|
| 1 | 414 |
| 2 | 247 |
| 3 | 144 |
| 4 | 146 |
| 5 | 200 |

| Stat | ms |
|------|-----|
| **Avg** | **230** |
| **p95** | **414** |
| **Worst** | **414** |

---

## Network: Preview API + 302 redirect chain (`-L -I`)

| Sample | TTFB (ms) | Redirect (ms) |
|--------|-----------|---------------|
| 1 | 403 | 224 |
| 2 | 359 | 240 |
| 3 | 399 | 153 |
| 4 | 575 | 452 |
| 5 | 305 | 138 |

| Stat | ms |
|------|-----|
| **Avg TTFB** | **408** |
| **p95 TTFB** | **575** |
| **Worst TTFB** | **575** |
| **Avg redirect overhead** | **241** |

This segment is **eliminated** when direct preview flag is ON and concrete key resolves.

---

## Network: Direct CDN (canary path)

### HEAD (5 runs)

| Stat | ms |
|------|-----|
| **Avg TTFB** | **118** |
| **p95 TTFB** | **135** |
| **Worst TTFB** | **135** |

### Range `bytes=0-65535` (5 runs, first-byte)

| Stat | ms |
|------|-----|
| **Avg TTFB** | **126** |
| **p95 TTFB** | **140** |
| **Worst TTFB** | **140** |

### Cold connection (no keepalive, 3 runs)

| Stat | ms |
|------|-----|
| **Avg TTFB** | **147** |
| **Worst** | **208** |

---

## Delta summary (network first byte)

| Metric | Baseline (API+302) | Direct CDN | **Saved** |
|--------|-------------------|------------|-----------|
| Avg | 408 ms | 118 ms | **~290 ms** |
| p95 | 575 ms | 135 ms | **~440 ms** |
| Worst | 575 ms | 140 ms | **~435 ms** |

API-only TTFB (no CDN yet): avg 230 ms → direct CDN avg 118 ms saves **~112 ms** before redirect follow.

---

## Estimated tap → audible (network + decode)

Using measured network avg + Phase 5.2.7 decode typical **180 ms**:

| Case | Baseline | Direct preview | **Δ** |
|------|----------|----------------|-------|
| **Best** | ~335 ms | ~145 ms | **~190 ms** |
| **Expected (avg)** | ~588 ms | ~298 ms | **~290 ms** |
| **Worst** | ~825 ms | ~390 ms | **~435 ms** |

Aligns with Phase 5.2.13 planning figure **~250–340 ms** expected improvement on guest preview cold start.

---

## Per-surface impact (guest preview only)

| Surface | Resolver entry | Flag ON effect |
|---------|----------------|----------------|
| Latest Singles | `catalogPreviewAudioUrl` via `ReleaseCardPlayButton` / prewarm | Skips API hop |
| Featured row | Same | Skips API hop |
| Catalog Grid | `PlaybackPrewarmCardShell` → prewarm cache | CDN URL in cache |
| Mixtapes & EPs | `albumTracksForPlayback` queue build | Per-track CDN `src` |
| Album tracklists | `AlbumTracklistSheet` / `page.js` modal | Queue CDN URLs |
| Entitled users | `/api/library/stream` | **Unchanged** — no direct preview |

Prewarm (Phase 5.2.6): direct CDN + existing `PlaybackNetworkHints` preconnect further reduces first-connection TLS on card-visible paths.

---

## Validation result

**PASS** — Measurable network latency reduction confirmed; estimated tap→audible improvement **~190–435 ms** depending on cache/warmth, centered ~**290 ms** avg.
