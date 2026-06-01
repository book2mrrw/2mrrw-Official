# Phase 5.2.9 — Platform Comparison (src → loadedmetadata)

**Metric:** `playback-src-to-loadedmetadata` / Resource Timing `ttfbMs`

---

## Summary table

| Platform | src→metadata (cold preview) | Resource Timing detail | Status |
|----------|----------------------------|------------------------|--------|
| **Desktop Chrome** (dev) | **80–250 ms** (baseline) | Full if `Timing-Allow-Origin` | **Methodology + instrumentation** |
| **Safari iPhone** | **100–280 ms** est. | WebKit media fetch; aggressive Range | **requires-device-run** |
| **Chrome iOS** | **90–260 ms** est. | WebKit networking stack (same as Safari) | **requires-device-run** |
| **Chrome Android** | **80–240 ms** est. | Often lower TLS reuse | **requires-device-run** |
| **Samsung Internet** | **85–250 ms** est. | Chromium-based; similar to Chrome Android | **requires-device-run** |

---

## Expected differences (theory)

### Safari iPhone

- Strong connection pooling to CDN after preconnect.
- May defer `loadedmetadata` until sufficient buffer — parse segment **may read higher** than curl suggests.
- Low Power Mode / background: `suspend` events extend gap — check `readyStateAnalysis` in dump.

### Chrome iOS

- Same WebKit media element as Safari; differences usually <10% for same build generation.

### Chrome Android

- Parallel DNS; sometimes faster TLS resume.
- Cellular RTT adds **+50–200 ms** to TTFB vs desktop Wi‑Fi — **requires-device-run**.

### Samsung Internet

- Align with Chrome Android; verify Samsung battery optimizations don't throttle fetch on first tap.

---

## Device test script

1. Install build or use Vercel preview with `NODE_ENV=development` **not** available on prod — use local dev on LAN or TestFlight internal with perf logging disabled in prod.
2. For production-like latency on device: use **Safari Web Inspector** → Timings tab on media request (alternative to `dumpPlaybackTiming`).
3. Record: TTFB, Content Download, `loadedmetadata` relative to `src` in Performance timeline.

---

## Agent curl (2026-05-31, US, Wi‑Fi)

Not a browser — used for **TTFB anchor only** (**131–195 ms**). Do not conflate with mobile Safari without device run.

---

## Attribution by platform

| Segment | Desktop (measured/proxy) | Mobile (expected) |
|---------|--------------------------|-------------------|
| TTFB | **131–195 ms** curl | +0–150 ms cellular |
| Cold TLS w/o preconnect | +35 ms curl warm | +40–150 ms |
| ID3/parse | **15–55 ms** est. | **20–70 ms** est. |
