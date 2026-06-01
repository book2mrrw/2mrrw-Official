# Error Analysis — Phase 5.2.15 Direct Preview Canary

**Run date:** 2026-05-31

---

## 404 rate analysis

| Asset class | Probe | HTTP | Client behavior (flag ON) |
|-------------|-------|------|---------------------------|
| Canonical nested preview | CDN HEAD hour-glass | **200** | Direct play OK |
| Flat legacy root | CDN `previews/hourglass-preview.mp3` | **404** | **Blocked** — resolver maps to nested key |
| Unknown slug folder | API `unknown-release-xyz` | **404** | Falls back to API URL (no direct CDN emitted) |
| Legacy API flat param | API `?legacy=previews/hourglass-preview.mp3` | **302** → may 404 at CDN | API still handles migration |

**Before vs after:** Direct preview **reduces** flat-root CDN hits by blocking ineligible keys. Unknown releases still 404 via API (unchanged).

---

## Invalid asset handling

| Error type | Baseline | Direct preview |
|------------|----------|----------------|
| CDN 404 on play | After API 302 | Immediate on direct URL |
| Wrong MIME / corrupt file | Element `error` event | Same |
| Availability cache | `writeAvailabilityCache` slug-based | **Unchanged** |
| Play button gating | `getPlayButtonState` | **Unchanged** |

Gap: no automatic CDN→API retry on element error (optional enhancement).

---

## Fallback activation

| Trigger | Activates fallback? |
|---------|---------------------|
| No concrete key at resolve time | **Yes** — API discovery URL |
| `isSiteApiMediaPath(preview)` | **Yes** — passthrough |
| Stream 401/403/404 | **Yes** — `getTrackPreviewSrc` |
| CDN 404 at runtime | **Partial** — user sees error; manual replay may retry (no auto-retry) |

---

## Playback failure paths (code review)

**File:** `AudioContext.js` play error handlers

- Stream fetch failure → preview fallback via `getTrackPreviewSrc`
- Preview error → availability cache + user feedback
- Watchdog at 15s for stuck commands — unchanged

Direct preview does not add new failure modes; removes one network failure point (Vercel API hop).

---

## Error rate expectation (staging canary)

| Metric | Expected change |
|--------|-------------------|
| `/api/media/preview` 5xx | **Down** for bypassed releases |
| CDN 404 | **Flat** — same objects |
| Client playback errors | **Flat or down** — fewer redirect failures |
| Entitled stream errors | **Unchanged** |

Monitor during staging: CDN 404 by path prefix + client `playback/events` error types.

---

## Overall error analysis

**PASS** — No new error classes introduced; flat-key 404 risk mitigated by eligibility guard. Optional CDN error retry not blocking canary.
