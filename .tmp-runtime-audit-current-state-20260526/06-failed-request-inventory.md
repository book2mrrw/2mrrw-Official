# 06 Failed Request Inventory

## Observed failed/guarded requests from probes
1. `GET https://www.2mrrw.com/api/library/stream?slug=hourglass` -> `401` (unauthenticated)  
   Evidence: `raw/01-origin-and-cors-probes.txt`; guard logic at `src/app/api/library/stream/route.js:43`.
2. `OPTIONS https://2mrrw.com/api/account/state` -> `307` redirect to www origin path  
   Evidence: `raw/01-origin-and-cors-probes.txt`.

## Potential failure classes in current code (not directly re-produced here)
- Entitlement denied path -> `403` from stream route (`src/app/api/library/stream/route.js:43`).
- Concurrent stream conflict branch -> conflict handling in player (`src/context/AudioContext.js:770`-`:782`) and stream route event/session logic (`src/app/api/library/stream/route.js:75` onward).
- Stream fetch/client-side failures surfaced via `fetchLibraryStream` call sites (`src/context/AudioContext.js:795`, `src/lib/playback/stream-client.js:61`).
