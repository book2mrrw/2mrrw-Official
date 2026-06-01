# Analytics Validation — Preview API vs Direct CDN

**Section result: PASS**

Preview API records **no play counts** and **no playback analytics**. All telemetry is **client-side** (slug-based) or **entitled stream** (library API).

---

## 1. Does play count go through preview API?

**No.**

| Path | Records plays? |
|------|----------------|
| `/api/media/preview` | ❌ Stateless 302 / discovery only |
| `POST /api/playback/events` | ✅ Client (`control-system/playback.js`) |
| `/api/library/stream` + stream end | ✅ Entitled only (`media_stream_events`) |

---

## 2. Client playback events

**File:** `src/lib/control-system/playback.js`

- `sendControlSystemPlaybackEvent(track, eventType, details)`
- Payload: `slug`, `title`, `source`, `positionSeconds`, `playbackAccess` — **not** audio URL host
- Triggered from `AudioContext` on play, progress, pause, complete, seek, replay

**Impact of direct CDN:** **None.** Events fire when `<audio>` plays regardless of whether `src` is:

- `/api/media/preview?folder=…`
- `https://pub-*.r2.dev/previews/.../...-preview.mp3`

---

## 3. Entitled stream analytics

**File:** `src/lib/playback/stream-client.js`

- `fetchLibraryStream` → stream session metadata
- `endStreamAnalytics` → stream end POST

Guest preview **never** enters this path. Unchanged by preview activation.

---

## 4. Resolver diagnostics

`recordPlaybackResolverOutcome` — **entitled** `resolve-playback-key` only. Preview path does not emit resolver marks.

---

## 5. Observability delta

| Signal | With API | Direct CDN |
|--------|----------|------------|
| Vercel `/api/media/preview` logs | ✅ | Reduced for bypassed releases |
| CDN/R2 access logs | After 302 | Direct (same object key) |
| Client `play` events by slug | ✅ | ✅ unchanged |
| Preview-specific API metrics | Query `folder=` param | **Harder** — use client events |

**Replacement need:** **None** for product analytics. Optional dev metadata `previewDelivery: "direct_cdn"` for A/B only.

---

## 6. Prewarm / performance marks

| Instrument | Preview API specific? |
|------------|----------------------|
| `PLAYBACK_FIRST_BYTE` | No — audio element |
| Prewarm `previewSrc` in cache | Stores string — will be CDN after activation |
| `logPlayback("play_track")` | No URL in payload |

---

## Verdict

**PASS** — No analytics pipeline changes required for direct preview activation.
