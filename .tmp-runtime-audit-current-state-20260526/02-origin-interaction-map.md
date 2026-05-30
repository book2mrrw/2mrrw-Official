# 02 Origin Interaction Map

## Redirect and origin relationships
- Apex -> www redirect: `https://2mrrw.com` returns `307 location: https://www.2mrrw.com/` (probe: `raw/01-origin-and-cors-probes.txt`).
- Storefront API apex path also redirects to www: `https://2mrrw.com/api/account/state` -> `307` to `https://www.2mrrw.com/api/account/state` (same probe file).

## Cross-origin interactions observed
- Storefront -> Control System (`/api/releases`, `/api/sync/stream`): OPTIONS `204` with reflected ACAO for both www and apex origins (probe evidence).
- Control System -> Storefront (`/api/account/state`): endpoint responds (`204` OPTIONS, `200` GET), but tested response does not include explicit ACAO in captured headers (probe evidence).
- Storefront `/api/library/stream` unauthenticated GET returns `401` (probe evidence), matching guarded stream route behavior (`src/app/api/library/stream/route.js:43` + auth checks in route).

## Code-level CORS gates
- Control System allowed-origin logic for public endpoints: `/Users/recharge/2MRRW-Control-System/src/app/api/releases/route.ts:12`.
- Control System streaming endpoint CORS: `/Users/recharge/2MRRW-Control-System/src/app/api/sync/stream/route.ts:5`.
- Shared origin helper path: `/Users/recharge/2MRRW-Control-System/src/server/http.ts:30`.
