# Observability Architecture — Client (Phase 6)

**Date:** 2026-05-24  
**Module:** `src/lib/observability/client-log.js`

---

## Goals

- Structured, namespaced client events without polluting production consoles
- Zero impact on entitlements, Stripe, or auth flows
- Composable with future server-side log drains (not implemented in this pass)

---

## clientLog API

```js
clientLog(level, event, data?)
```

| Level | Dev behavior | Production behavior |
|-------|--------------|---------------------|
| `debug` | `console.debug` | Sampled (~2%) or silent |
| `info` | `console` | Sampled (~2%) or silent |
| `warn` | `console.warn` | ~10% of sample rate |
| `error` | `console.error` | ~10% of sample rate |

Payload shape:

```json
{ "event": "play_track", "ts": 1730000000000, "domain": "playback", "trackId": "..." }
```

---

## logPlayback helper

Thin wrapper for media domain:

```js
logPlayback("play_track", { trackId, source })
```

**Current wiring:** `AudioContext.playTrack` emits `play_track` after cover preload hint.

**Explicitly not logged:** stream URL resolution, signed URLs, auth tokens, webhook payloads.

---

## Dev-only companions

| Tool | Path | Purpose |
|------|------|---------|
| `useRenderTracker` | `src/lib/dev/useRenderTracker.js` | Re-render counts |
| `performanceMarks` | `src/lib/dev/performanceMarks.js` | `performance.mark` / `measure` |

---

## Production hardening (Phase 7)

- `src/app/error.js` — route error boundary; logs `app_route_error` via `clientLog("error", ...)`
- User-facing dark-theme fallback with `reset()` CTA

---

## Future extensions (document-only)

1. **Correlation ID** — attach `x-request-id` from `/api/account/state` fetches to client logs
2. **Web Vitals** — optional `reportWebVitals` bridge (Vercel Analytics)
3. **Server ingest** — POST sampled client events to `/api/telemetry` with rate limit
4. **Stripe/Supabase** — remain server-logged only; never duplicate webhook secrets client-side

---

## Rollback

Remove import from `AudioContext.js` and delete `src/lib/observability/` — no schema or env changes in this pass.
