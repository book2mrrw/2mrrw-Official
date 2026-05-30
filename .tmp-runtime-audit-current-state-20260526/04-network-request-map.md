# 04 Network Request Map

## Probe set executed
- Redirect probes: `https://www.2mrrw.com/`, `https://2mrrw.com/`.
- Control System CORS probes: OPTIONS on `/api/releases`, `/api/sync/stream` with `Origin: https://www.2mrrw.com` and `Origin: https://2mrrw.com`.
- Storefront probes: OPTIONS/GET on `/api/account/state` and `/api/library/stream?slug=hourglass`.
- Full headers/status snapshot: `raw/01-origin-and-cors-probes.txt`.

## Status/CORS matrix (compact)
- `GET https://www.2mrrw.com/` -> `200`.
- `GET https://2mrrw.com/` -> `307` to www.
- `OPTIONS https://2mrrw-control-system.vercel.app/api/releases` -> `204`, ACAO reflects origin, credentials enabled.
- `OPTIONS https://2mrrw-control-system.vercel.app/api/sync/stream` -> `204`, ACAO reflects origin.
- `OPTIONS https://www.2mrrw.com/api/account/state` -> `204`.
- `GET https://www.2mrrw.com/api/account/state` -> `200`.
- `OPTIONS https://www.2mrrw.com/api/library/stream?slug=hourglass` -> `204`.
- `GET https://www.2mrrw.com/api/library/stream?slug=hourglass` -> `401` (expected for unauthenticated request path).

## Reliability note
- Probe output is intentionally compact and split into raw snippet file to prevent stream/output overflow.
