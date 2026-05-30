# Absolute URL Inventory (src/)

## Playback-critical (must convert / preserve cookie continuity)

- `src/lib/control-system/client.js:38` — `buildControlSystemUrl` previously built absolute control-system URLs for browser `/api/*` requests (affected playback metadata, sync replay/stream hydration, and playback telemetry callers).
- `src/lib/control-system/playback.js:53` — playback telemetry uses `buildControlSystemUrl("/api/playback/events")` (cookie continuity sensitive).
- `src/hooks/sync/useRealtimeEvents.js:133` — sync replay uses `buildControlSystemUrl("/api/sync/replay")` (playback-adjacent catalog/session hydration).
- `src/hooks/sync/useRealtimeEvents.js:157` — realtime sync stream uses `buildControlSystemUrl("/api/sync/stream")` (playback-adjacent state continuity).
- `src/lib/control-system/releases.js:384` — release fetch path uses `fetchControlSystemJson("/api/public/releases")` via shared URL builder.
- `src/lib/control-system/releases.js:395` — release media preload path uses `fetchControlSystemJson("/api/releases/:slug/media")` via shared URL builder.
- `src/lib/control-system/releases.js:462` — release detail path uses `fetchControlSystemJson("/api/releases/:slug")` via shared URL builder.

## Non-playback absolute external calls (left unchanged)

- `src/app/api/printful/products/route.js:88` — Printful upstream API call; server-side commerce integration.
- `src/lib/commerce/handle-stripe-webhook.js:285` — Printful upstream API call; server-side fulfillment workflow.
- `src/lib/gifts/email.js:99` — Resend upstream API call; server-side transactional email.
- `src/lib/gifts/email.js:153` — Resend upstream API call; server-side transactional email.

## No matches found for requested patterns

- `2mrrw-control-system.vercel.app`
- `NEXT_PUBLIC_API_URL`
- `API_BASE_URL`
