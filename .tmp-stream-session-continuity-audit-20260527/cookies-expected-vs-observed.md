# Cookies expected vs observed

## Confirmed transport observations

### Browser capture (authenticated devtools cookie header unavailable)
- Confirmed browser request to `https://www.2mrrw.com/api/library/stream?slug=hour-glass` returns `401` when unauthenticated (MCP CDP Runtime.evaluate probe).
- `document.cookie` at that moment only had Stripe cookies (`__stripe_mid`, `__stripe_sid`), and no readable app session cookies.
- Attempting DevTools cookie introspection via CDP `Network.getCookies` is blocked by tooling policy (`CDP method 'Network.getCookies' is not allowed`).

### HTTP probes (curl)
- Anonymous `GET https://www.2mrrw.com/api/library/stream?slug=hour-glass` -> `401 {"error":"Unauthorized"}`.
- `POST https://www.2mrrw.com/api/guest/session` sets:
  - `Set-Cookie: guest_session=...; Path=/; Expires=...; Max-Age=31536000; Secure; HttpOnly; SameSite=lax`
- Replaying that cookie to stream endpoint:
  - `GET https://www.2mrrw.com/api/library/stream?slug=hour-glass` with cookie -> `403 Not entitled to stream this item`.
  - This confirms server successfully read `guest_session` (request moved from `401` to authenticated entitlement path).

## Expected cookies by code path

### `guest_session`
- Cookie name is hard-coded as `guest_session` in `src/lib/guest-session.js`.
- It is `HttpOnly`, `Secure` (prod), `SameSite=lax`, `Path=/` in `withGuestCookie`.
- `getGuestUser()` depends on this cookie for guest fallback user resolution.

### Supabase auth cookies
- Server-side Supabase client reads all request cookies from Next `cookies()` (`src/lib/supabase/server.js`).
- Middleware refresh path also reads/writes through request/response cookie adapters (`src/lib/supabase/middleware.js`).
- No app-specific override for Supabase cookie names exists in repository code; names come from Supabase SSR/client defaults.

## Credentials transport assumptions
- Stream fetch uses same-origin relative URL + `credentials: "include"` (`src/lib/playback/stream-client.js`).
- For same-origin requests, credentials include sends first-party cookies for that origin.
- If page origin is apex (`2mrrw.com`) and API redirects to `www.2mrrw.com`, request becomes cross-origin redirect hop; cookie continuity then depends on cookie host scope/domain and redirect behavior.

## Confirmed vs manual-required

### Confirmed
- `guest_session` is set and consumed on www flow.
- No session yields 401 in stream route.
- Guest session present but not entitled yields 403.

### Needs authenticated-browser-capture
- Exact Supabase cookie names present on `GET /api/library/stream?slug=hour-glass` for a signed-in user (HttpOnly values not visible in `document.cookie` and DevTools cookie CDP method is blocked in this tool environment).
