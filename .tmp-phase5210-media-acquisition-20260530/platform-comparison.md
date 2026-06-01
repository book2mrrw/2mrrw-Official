# Platform Comparison — Measured vs Device-Required

**Probe date:** 2026-05-31

---

## What curl measures (this phase)

| Stage | Tool | Status |
|-------|------|--------|
| Preview API 302 | curl → `www.2mrrw.com` | **Measured** |
| CDN Range TTFB | curl → `pub-643…r2.dev` | **Measured** |
| Stream guest 401 | curl | **Measured** |
| Entitled stream + sign + proxy | curl | **Not measured** (needs session) |
| Connection reuse in `<audio>` | curl | **Approximate** — CLI ≠ browser pool |
| `loadedmetadata` / Resource Timing | browser | **requires-device-run** |

---

## Browser matrix

| Platform | curl proxy | Device validation |
|----------|------------|-------------------|
| **Safari iOS** | Same CDN host/headers | **requires-device-run** — Range policy, preconnect, ID3 parse |
| **Chrome Android** | Same | **requires-device-run** |
| **Samsung Internet** | Same | **requires-device-run** |
| **Desktop Safari/Chrome** | Same | DevTools Network + `dumpPlaybackTiming()` |

---

## Measured vs expected (guest preview)

| Metric | curl (agent egress) | Phase 5.2.8–5.2.9 device bucket |
|--------|---------------------|----------------------------------|
| CDN Range TTFB | **115–210 ms** | **80–250 ms** src→metadata network |
| API 302 TTFB | **139–391 ms** | Adds before `src` assign |
| Full chain (-L file) | **3.5 s** | Misleading vs metadata — use Range |

---

## Dev instrumentation (unchanged)

`dumpPlaybackTiming()` → `sourceAcquisition`, `sourceAcquisitionAttribution` (Phase 5.2.9 `performanceMarks.js`).

Procedure:

1. `npm run dev` on device LAN or prod.
2. Play Hour Glass preview as guest.
3. Console: `dumpPlaybackTiming()`.
4. Compare `ttfbMs` to curl **115–210 ms**; delta ≈ parse + main-thread.

---

## HAR comparison (operator)

Export Safari Web Inspector HAR on tap→play:

- Row 1: `/api/media/preview` — **302**, wait time ≈ API TTFB.
- Row 2: `hourglass-preview.mp3` — **206**, `timing.wait` ≈ CDN TTFB.

Sum ≈ curl range chain **~315 ms** when Vercel HIT + warm CDN.

---

## STOP

No platform-specific code changes in 5.2.10.
