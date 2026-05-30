# Domain and cookie policy audit

## Canonical domain behavior
- `next.config.mjs` redirects host `2mrrw.com` to `https://www.2mrrw.com/:path*`.
- Curl confirms apex stream call returns `307` to www stream URL.

## Cookie policy in code

### Guest cookie
- `guest_session` options from `src/lib/guest-session.js`:
  - `httpOnly: true`
  - `sameSite: "lax"`
  - `secure: process.env.NODE_ENV === "production"`
  - `path: "/"`
  - **No explicit `domain`** attribute

Implication: cookie is host-only for the host that set it.

### Supabase cookies
- App does not set explicit Supabase cookie domain options in repo code.
- Middleware/server adapters pass through Supabase-managed cookie set/get operations.

## Redirect and cookie continuity risk
- Because apex redirects to www, a request initiated on apex can cross host boundary.
- Host-only cookies set on one host are not guaranteed on the other host.
- For session continuity, users must effectively operate on canonical `www` origin for both auth issuance and API calls.

## Confirmed probes
- `https://2mrrw.com/api/library/stream?slug=hour-glass` -> `307` location to `https://www.2mrrw.com/...`.
- `guest_session` created on www is explicitly host-bound in cookie jar (`#HttpOnly_www.2mrrw.com ... guest_session ...`).

## Conclusion
- Domain split (apex vs www) is a credible session continuity failure source when auth/session cookies are host-only and request starts on non-canonical host.
