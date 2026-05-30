# Phase B — Fix Summary

**Date:** 2026-05-27

## Files changed

1. **`src/app/api/playback/events/route.js`** (new)
   - `OPTIONS` → 204
   - `POST` forwards body, `x-control-session-id`, and cookies to `https://2mrrw-control-system.vercel.app/api/playback/events` (stable CS alias — production env was empty/stale preview URL)
   - Returns upstream status/body; 502 if CS unreachable

2. **`src/lib/control-system/playback.js`**
   - On failed telemetry: `console.debug` only when `NODE_ENV === "development"`
   - Still returns `false`; never throws

## Commits

| SHA | Message |
|-----|---------|
| `e0ca4c3` | fix(runtime): harden telemetry and cleanup stale asset requests |
| `1d7bd04` | fix(runtime): fallback CS origin for playback events proxy |
| `9339e86` | fix(runtime): pin playback events proxy to stable CS origin |

## Verification

- Local `npm run build` — pass
- Production deploy: `dpl_JDLPREgNyp5Uhurx1PsMHTgioh2h` (final pin `9339e86`) → https://www.2mrrw.com
- Post-deploy probe: `POST https://www.2mrrw.com/api/playback/events` → **200** JSON (was **404** pre-fix)

## Out of scope (audit only)

- Stream 401/403 entitlement path
- Client-side CS GET same-origin 404s (`/api/hero`, etc.)
- Image / preload / Printful console noise
- Setting `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` on Vercel (recommended follow-up for catalog client reads)
