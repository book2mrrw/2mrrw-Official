# 05 Console Error Inventory

## Non-auth verifiable now
- No live authenticated browser-console capture was run in this recovery pass.
- Non-auth runtime probe evidence confirms unauthenticated stream guard returns `401` (`raw/01-origin-and-cors-probes.txt`), which can surface as client-side playback/access errors depending on caller handling.

## Code-side console/error emission points (inventory)
- Stream API route failure logging: `src/app/api/library/stream/route.js:121`, `src/app/api/library/stream/route.js:158`.
- AudioContext invalid/failed play diagnostics: `src/context/AudioContext.js:992`, `:997`, `:1015`, `:1027`.
- R2 env mismatch warning path: `src/lib/storage/r2-public-cdn.js:4`, `:29`.
- Control media fetch fallback risk path: `src/lib/control-system/media.js:67` and signed URL resolution logic under same module.

## Requires manual authenticated capture
- Subscriber/owner playback console behavior during signed-URL fetch, token refresh, and concurrent-stream conflict flows.
- Session-sensitive `/api/library/stream` 403/409 branches from real authenticated account states.
- Cross-tab/device conflict UX + console output during stream override path in `AudioContext` (`src/context/AudioContext.js:749`, `:770`-`:782`).
