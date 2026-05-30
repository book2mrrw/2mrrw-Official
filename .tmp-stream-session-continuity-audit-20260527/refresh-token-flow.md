# Refresh token flow audit

## Where refresh is invoked

### Middleware refresh path
- `middleware.js` runs `updateSession(request)` on all non-excluded routes.
- Matcher excludes `api/guest/*`, static assets, and selected public paths; `/api/library/stream` is included.
- Inside `updateSession`, `await supabase.auth.getUser()` triggers Supabase SSR token validation/refresh behavior.

### Client refresh path
- Browser Supabase client (`src/lib/supabase/client.js`) enables:
  - `autoRefreshToken: true`
  - `persistSession: true`
  - `storageKey: "2mrrw-auth-token"`
- AuthContext also attempts Safari/localStorage restoration via `supabase.auth.setSession(...)` when direct session missing.

## Why `/auth/v1/token?grant_type=refresh_token` can fail in this architecture

- Missing refresh-token cookie/server-visible session on request.
- Malformed or stale refresh token (revoked/expired/rotated).
- Supabase project/env mismatch (`NEXT_PUBLIC_SUPABASE_URL` or anon key points at different project than issued token).
- Domain/host transition (`2mrrw.com` <-> `www.2mrrw.com`) causing host-only cookie non-delivery on redirected request.
- Middleware exclusions (e.g. `api/guest/*`) intentionally skip refresh for those routes.

## Probe-able evidence currently available
- Browser fetch on `https://www.2mrrw.com/api/library/stream?slug=hour-glass` returns 401 when unauthenticated.
- Anonymous curl to same endpoint returns 401.
- Guest session cookie replay changes outcome to 403, proving cookie transport changes auth branch.

## Not directly captured in this run
- Live authenticated browser network entry for `/auth/v1/token?grant_type=refresh_token` with request/response payload.
- Server logs containing explicit refresh error strings for failing production user session.

## Confirmed vs needs-authenticated-browser-capture

### Confirmed
- Middleware calls `supabase.auth.getUser()` for stream route path.
- Client is configured for auto refresh + persisted session.

### Needs-authenticated-browser-capture
- Exact failing refresh reason for the specific 401 incident user/session.
