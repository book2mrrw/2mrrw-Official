# Same-Origin Playback Fix Report

## Objective

Remove cross-origin absolute backend API URL construction in the frontend playback path so browser requests use same-origin `/api/...` routes and preserve cookie/session continuity.

## What changed

- Updated `src/lib/control-system/client.js` in `buildControlSystemUrl`:
  - Browser-side `/api/...` targets now resolve to same-origin and are returned as relative paths (`/api/...?...`) for `fetch` / `EventSource`.
  - `apiBaseUrl` returned to callers is set to `window.location.origin` for browser same-origin mode, preserving downstream media endpoint composition behavior.
  - Server-side behavior remains unchanged (still uses configured control-system base URL).

## Why this is production-safe

- Change is narrowly scoped to URL construction logic only.
- No AudioContext, queue, playback engine flow, or UI behavior was refactored.
- Existing callers (`fetchControlSystemJson`, playback telemetry, sync replay/stream) keep the same call shape; only browser URL origin behavior changes.

## Before / After URL patterns

- Before (browser):
  - `https://<control-system-origin>/api/playback/events`
  - `https://<control-system-origin>/api/public/releases?...`
  - `https://<control-system-origin>/api/sync/stream`
- After (browser):
  - `/api/playback/events`
  - `/api/public/releases?...`
  - `/api/sync/stream`

## Files changed (code)

- `src/lib/control-system/client.js`
