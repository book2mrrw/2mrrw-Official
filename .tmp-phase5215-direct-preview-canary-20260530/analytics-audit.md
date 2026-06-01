# Analytics Audit — Phase 5.2.15 Direct Preview Canary

**Run date:** 2026-05-31  
**Method:** Code review + grep (no prod changes)

---

## Play counts / attribution

| Path | Records plays? | Direct preview impact |
|------|----------------|----------------------|
| `/api/media/preview` | **No** — stateless 302 | Reduced Vercel traffic only |
| `POST /api/playback/events` | **Yes** — slug-based | **None** |
| `/api/library/stream` + stream end | **Yes** — entitled | **None** — guest never uses |
| PostHog (`posthogAdapter.js`) | Client events by type | **None** — no URL in payload |

---

## Client playback events

**File:** `src/lib/control-system/playback.js`

- `sendControlSystemPlaybackEvent(track, eventType, details)`
- Payload fields: `slug`, `title`, `source`, `positionSeconds`, `playbackAccess`
- Triggered from `AudioContext` on play, progress, pause, complete, seek, replay
- **Does not include** `track.src` hostname or delivery mode

Direct CDN changes byte origin only; event firing unchanged when `<audio>` plays.

---

## Entitled stream analytics

**File:** `src/lib/playback/stream-client.js`

- `fetchLibraryStream`, `endStreamAnalytics` — entitled path only
- `recordPlaybackResolverOutcome` — hybrid stream resolver, not preview

**Unchanged** by direct preview flags.

---

## Observability delta

| Signal | Baseline | Direct preview canary |
|--------|----------|----------------------|
| Vercel `/api/media/preview` logs | Full guest preview traffic | Reduced for canonical releases |
| CDN/R2 access logs | After 302 | Direct (same object keys) |
| Client play events by slug | Yes | Yes — unchanged |
| Preview API `folder=` metrics | Available | Partially bypassed — use client events |

**Replacement need:** None for product analytics.

Optional dev-only: `previewDelivery: "direct_cdn"` in performance marks scenario meta (not required).

---

## Prewarm / performance instrumentation

| Instrument | URL-specific? | Impact |
|------------|---------------|--------|
| `PLAYBACK_TAP` → `PLAYBACK_AUDIBLE` | No | Unchanged |
| `dumpPlaybackTiming()` | Records `sourceAcquisition.resourceTimingTtfbMs` | May show lower TTFB (expected) |
| Prewarm cache `previewSrc` | Stores resolved string | CDN URL when flag ON |

---

## Overall analytics audit

**PASS** — No analytics pipeline changes required. Attribution remains slug-based; entitled analytics isolated.
