# 09 Deployment Audit

## Runtime endpoints probed
- `https://www.2mrrw.com/` reachable (HTTP 200).
- `https://2mrrw.com/` apex redirects to www (HTTP 307).
- `https://2mrrw-control-system.vercel.app/api/releases` and `/api/sync/stream` return CORS-enabled OPTIONS 204 for both www and apex origins.
- `https://www.2mrrw.com/api/account/state` returns 200 on GET.
- `https://www.2mrrw.com/api/library/stream?slug=hourglass` returns 401 unauthenticated.

Evidence: `raw/01-origin-and-cors-probes.txt`.

## Deployment-level observations (current state only)
- Canonical public web surface is effectively `www` due apex redirect behavior.
- Control System appears configured to allow both apex and www storefront origins on tested API paths.
- Storefront stream endpoint is live and enforcing auth/entitlement gate as expected for unauthenticated requests.

## Unknowns needing authenticated/manual verification
- Authenticated stream success path (200 with signed URL JSON/redirect behavior under real user session).
- 403 and 409 branches under real entitlement and concurrent-session conditions.
