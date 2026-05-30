# Playback Events Runtime Loop Audit + Hardening

**Date:** 2026-05-27  
**Repo:** artist-platform  
**Production probe:** `POST https://www.2mrrw.com/api/playback/events` → **200** JSON

---

## Phase 1 — Caller trace

| Location | Role |
|----------|------|
| `src/lib/control-system/playback.js` | Sole implementation — `sendControlSystemPlaybackEvent` |
| `src/context/AudioContext.js` | `persistPlayback` (play/progress/pause/complete), `replay`, `seek` |
| `src/lib/control-system/client.js` | `buildControlSystemUrl` — browser rewrites `/api/*` to storefront same-origin |
| `src/app/api/playback/events/route.js` | Storefront POST proxy → stable CS origin (9339e86+) |

**Grep summary:** No other production callers of `playback/events` or `sendControlSystemPlaybackEvent`.

### AudioContext lifecycle map

| Trigger | Event(s) sent |
|---------|----------------|
| `onPlay` | `play` via `persistPlayback` |
| `onPause` | `pause` via `persistPlayback` |
| `timeupdate` → `onTime` | `progress` via `persistPlayback` (15s throttle in AudioContext) |
| `onEnded` | `complete` via `persistPlayback` |
| `playTrack` replay branch | `replay` (direct) |
| `seek()` | `seek` (direct) |

**Intervals:** `positionSaveTimerRef` (localStorage position only, not CS telemetry). Cleared on pause, ended, effect cleanup.

**Not telemetry:** `fadeOut` / `swell` `setInterval` in `playTrack` — volume only.

---

## Phase 2 — Route status

| Endpoint | Status |
|----------|--------|
| `POST https://www.2mrrw.com/api/playback/events` | **200** (post-proxy) |
| `POST https://2mrrw-control-system.vercel.app/api/playback/events` | **200** |

Pre-proxy root cause: same-origin rewrite sent browser POSTs to storefront with **no route** → **404** HTML. That did **not** stop audio but flooded Network/console and could stack with rapid `timeupdate` + unbounded client sends.

---

## Phase 3 — Runaway analysis

| Candidate | Verdict |
|-----------|---------|
| Retry loop in client | **None before fix** — single `fetch`, no retry |
| 404-driven recursion | **No** — failure was fire-and-forget |
| `timeupdate` spam | **Partial** — AudioContext throttles `progress` to 15s for `/api/media/playback` + CS send together, but **no** playback.js dedupe; seek/replay unbounded |
| Duplicate listeners | **Unlikely** — effect cleanup removes listeners; deps stable enough |
| `ended` recursion | **Guarded** — `spuriousEndedGuardRef`, queue/repeat paths separate |
| Post-`complete` progress | **Yes** — `timeupdate` can still fire briefly after ended; progress telemetry not suppressed |

**Primary loop/noise cause:** Missing storefront proxy (404 storm) + unbounded duplicate event types at the telemetry layer.

---

## Phase 4–5 — Hardening (shipped)

### `src/lib/control-system/playback.js`

- **Dedupe:** Per `slug:eventType` windows (progress 15s, play/pause 3s, seek 2s, complete 10s).
- **Suppress after complete:** Blocks progress/pause/seek until next `play`/`replay`.
- **Retry:** Max 2 with backoff on 5xx/network only; **no retry on 4xx**.
- **Fire-and-forget:** `sendControlSystemPlaybackEvent` is sync; internal `void dispatchPlaybackEvent`.
- **Silent prod failures:** `console.debug` only when `NODE_ENV=development` or `NEXT_PUBLIC_DEBUG_PLAYBACK_EVENTS=1`.
- **Exports:** `resetPlaybackTelemetry()`, `getPlaybackTelemetryDiagnostics()` (dev).

### `src/context/AudioContext.js` (minimal)

- Call `resetPlaybackTelemetry()` on audio listener effect teardown.

### Route

- **Unchanged** — proxy already correct; production 200 confirmed.

---

## Phase 6 — Diagnostics

Enable with either:

- `NODE_ENV=development`, or
- `NEXT_PUBLIC_DEBUG_PLAYBACK_EVENTS=1`

Logs: dispatch, dedupe skip, suppress after complete, retry attempts, in-flight count.

---

## Root cause (summary)

1. **Historical:** Storefront lacked `/api/playback/events` while client used same-origin rewrite → repeated failed POSTs.
2. **Residual:** No client-side dedupe/suppression → duplicate progress/seek/play bursts under fast UI + post-ended `timeupdate`.

## Files changed

- `src/lib/control-system/playback.js` — telemetry hardening
- `src/context/AudioContext.js` — `resetPlaybackTelemetry()` on unmount

## Verification

- `npm run build` — success
- Production curl POST — 200
