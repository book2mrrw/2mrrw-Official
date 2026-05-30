# 04 — Optimized Playback Path

**Scope:** Document the intended fast path and gaps vs current behavior. **No architecture changes** in this phase — recommendations are listed in `06-recommended-fixes.md` for a future implementation pass.

## Target: minimum RTTs tap → audible

### Entitled full stream (ideal)

```
Tap
  → command queue (≤5 ms)
  → unlock + WebAudio resume (≤40 ms desktop / ≤80 ms iOS cold)
  → audio.src = /api/library/stream?slug=X&redirect=1   [0 client API round trips]
  → single GET (Range 0-) to same-origin proxy
       └─ server: auth + entitlement + resolvePlaybackKey (cached) + sign + proxy pump
  → first byte → canplay → play()
  → audible
```

**Already optimized in codebase:** client does not call `fetchLibraryStream` when `redirect=1` is on the track src from `resolvePlaybackSrc`.

**Remaining latency** is almost entirely server + first CDN/proxy bytes + decode.

### Guest preview (ideal)

```
Tap
  → command queue + unlock
  → audio.src = https://pub-….r2.dev/.../preview.mp3   [0 stream API]
  → CDN Range GET (browser)
  → canplay → audible
```

**Optional** `/api/media/preview` only when src is folder-based and needs 302 resolution — adds **~500–600 ms** API RTT (measured).

### Paths to avoid on hot tap

| Anti-pattern | Cost | When it still runs |
|--------------|------|-------------------|
| JSON `fetchLibraryStream` + HEAD | +1–2 RTT (+50–200 ms mobile typical; HEAD outliers to seconds) | Visibility refresh, legacy src without `redirect=1` |
| `backgroundStreamResolve` | Defers audible until background fetch completes | Entitled track without redirect param on src |
| Full preview download before play | Up to **2131 ms** for 832 KB MP3 (measured) | Cold cache, no Range |

## Optimized vs current — gap table

| Segment | Current | Optimized target | Gap |
|---------|---------|------------------|-----|
| Entitled client prefetch | Redirect path: none | None | **Aligned** |
| Stream API (server) | 279–804 ms TTFB on 401; est. 150–600 ms entitled | <200 ms warm with cache | **Server** — resolvePlaybackKey chain |
| Preview API | 602 ms when folder redirect used | 0 if direct CDN src on track | **Data** — embed CDN URL in catalog payload |
| CDN first byte | 954 ms (64 KiB range, this session) | <300 ms edge-cached | **CDN / cache** |
| Client HEAD probe | On JSON path only | Eliminate on refresh | **Code** — optional follow-up |
| React main thread | Phase 4.6 reduced churn | Stable during play | **Improved** (A1/A2) |
| Prod telemetry | None | Sampled tap→audible | **Observability** |

## Redirect path network waterfall (conceptual)

```
Browser                    2mrrw.com API              R2
   |-- GET stream?redirect=1 -->|
   |                            |-- entitlement DB -->|
   |                            |-- resolvePlaybackKey ->|
   |                            |-- sign URL ---------->|
   |                            |-- proxy GET --------->|
   |<--------- audio bytes ------------------------------|
```

One browser connection to origin; server may do 2–4 DB ops + sign per request (cold).

## Instrumentation on optimized path

Expected dev marks for entitled redirect play:

| Measure | Expected |
|---------|----------|
| playback-resolver | **null** |
| playback-signed-url | **null** |
| playback-src-to-first-byte | **dominant** |
| playback-tap-to-audible | Sum of unlock + network + decode |

Validation: compare Network panel single `library/stream` request vs JSON+HEAD double round-trip on refresh path.
