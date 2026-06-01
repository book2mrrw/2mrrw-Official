# Analytics Impact — Preview API vs Direct CDN

---

## What `/api/media/preview` records today

**Nothing.**

Code review of `src/app/api/media/preview/route.js`:

| Telemetry | Present? |
|-----------|----------|
| Database insert | ❌ |
| `media_stream_events` | ❌ |
| `/api/playback/events` proxy | ❌ |
| Server-side logging (success) | ❌ (errors only: `[media/preview] discovery failed`) |
| Server-Timing on edge HIT | ❌ (not emitted in production cache HIT) |
| Vercel access logs | ✅ (infra only — URL, status, cache state) |

The route is a **stateless redirector** with optional R2 discovery on MISS.

---

## Where playback analytics actually flow

### Client playback events (all tiers)

| Layer | File | Destination |
|-------|------|-------------|
| Event builder | `src/lib/control-system/playback.js` | `playbackEventPayload()` |
| Transport | `sendPlaybackEvent()` | `POST /api/playback/events` → Control System |
| Trigger | `AudioContext` + media engine | `play`, `progress`, `pause`, `complete`, etc. |

Payload includes: `slug`, `title`, `source`, `positionSeconds`, `playbackAccess`, **not** the audio URL host.

**Impact of direct CDN:** **None.** Events fire on `play`/`progress` regardless of whether `src` is API URL or CDN URL.

### Entitled stream analytics

| Layer | File | Destination |
|-------|------|-------------|
| Stream start | `/api/library/stream/route.js` | `media_stream_events` insert |
| Stream end | `stream-client.endStreamAnalytics` | `POST /api/stream/end` |
| Client resolver marks | `performanceMarks.js` | Dev-only |

Guest preview **never** hits these paths.

### Client observability

| Call | When |
|------|------|
| `logPlayback("play_track", …)` | `AudioContext.playTrackInternal` |
| `perfMark(MARKS.*)` | Tap, resolver, signed URL, first byte |
| `recordPlaybackResolverOutcome` | Entitled `resolvePlaybackKey` only |

Preview API redirect does not trigger resolver diagnostics.

---

## Vercel / CDN logging delta

| Signal | With API | Direct CDN |
|--------|----------|------------|
| `/api/media/preview` hits | Visible in Vercel | **Eliminated** for bypassed releases |
| `x-vercel-cache` HIT/MISS stats | Available | N/A for preview |
| CDN/R2 access logs | After 302 | Direct — same object key |
| Preview-specific request counting | Possible via API logs | **Harder** — indistinguishable from other CDN traffic unless tagged |

If product needs **preview fetch counts by release**, today that would require:

- Parsing Vercel logs for `folder=` query params, or
- Client-side telemetry (already have play events with `slug`)

Direct CDN **does not reduce** play-level analytics; it only removes API access-log visibility.

---

## Prewarm / performance instrumentation

| Instrument | Tracks preview API? |
|------------|---------------------|
| `PLAYBACK_RESOLVER_START/END` | Library stream JSON fetch only |
| `PLAYBACK_SIGNED_URL` | Signed stream HEAD only |
| `PLAYBACK_FIRST_BYTE` | Audio element events — **works for both paths** |
| Phase 5.2.6 prewarm cache | Stores `previewSrc` string — would store CDN URL after bypass |

---

## Analytics impact summary

| Category | Impact level | Notes |
|----------|--------------|-------|
| Playback events (CS) | **None** | Slug-based, client-fired |
| Stream events | **None** | Entitled path unchanged |
| Preview discovery metrics | **Low** | Lose API log granularity; play events remain |
| Error observability | **Low** | CDN 404 vs API 404 — need client error logging |
| A/B latency measurement | **Positive** | Cleaner waterfall (one fewer hop) |

---

## Recommendations (if implementing bypass)

1. **Do not** add preview API calls for analytics — unnecessary latency.
2. **Optional:** Add `metadata.previewDelivery: "direct_cdn" | "api_redirect"` in dev builds for A/B verification.
3. **Retain** client `play` events as source of truth for preview engagement.
4. **Monitor** CDN 404 rate via client `error` events on audio element if flat legacy paths slip through.
