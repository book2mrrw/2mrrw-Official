# Stream Session Continuity Audit (401 on `/api/library/stream?slug=hour-glass`)

Date: 2026-05-27  
Scope: Auth/session continuity only. No code changes.

## PHASE 1 — Cookie transport audit

### Findings
- Stream client calls same-origin relative endpoint with `credentials: "include"` (`src/lib/playback/stream-client.js`).
- Stream route user resolution is server-side: `getFanSessionUser() ?? getGuestUser()` (`src/app/api/library/stream/route.js`).
- `guest_session` is set as `Secure; HttpOnly; SameSite=lax; Path=/` with no `Domain` (`src/lib/guest-session.js`).
- Live browser probe at `https://www.2mrrw.com` shows 401 unauthenticated stream request.
- DevTools cookie-header capture for HttpOnly cookies is blocked in this environment (CDP `Network.getCookies` disallowed).
- Curl confirms `guest_session` can be set and then consumed (401 -> 403 shift).

### Cookie names expected and seen
- Expected:
  - `guest_session` (confirmed from code and Set-Cookie probe).
  - Supabase auth cookies (name pattern controlled by Supabase SDK defaults; no custom override in app code).
- Seen/observable in this run:
  - `guest_session` (Set-Cookie + cookie jar).
  - Browser-readable cookies only: Stripe cookies (`__stripe_mid`, `__stripe_sid`).

## PHASE 2 — Supabase session resolution audit

### Findings
- `getFanSessionUser()` -> `createClient()` -> `supabase.auth.getUser()` (`src/lib/auth/session-user.js`, `src/lib/supabase/server.js`).
- Non-guest email user returns profile-backed object.
- Guest-email or null user falls through to `getGuestUser()`.
- Stream route 401 occurs only if both fan session and guest session resolution return null.

### Exact null conditions for `auth.getUser()` in this stack
- Missing/invalid server-visible auth cookies/session.
- Refresh failure path unable to restore session.
- Domain/host mismatch preventing cookie delivery to current host.

## PHASE 3 — Refresh failure audit

### Findings
- Middleware runs for stream route and invokes `await supabase.auth.getUser()` (`middleware.js`, `src/lib/supabase/middleware.js`).
- Client SDK is configured with `autoRefreshToken: true`, `persistSession: true`, storage key `2mrrw-auth-token` (`src/lib/supabase/client.js`).
- Refresh can fail with missing/stale/malformed refresh token, env mismatch, or domain cookie miss.

### Evidence status
- Confirmed invocation points in code.
- No direct authenticated capture of failing `/auth/v1/token?grant_type=refresh_token` request payload in this run.

## PHASE 4 — Domain/cookie policy audit

### Findings
- Apex is redirected to www in `next.config.mjs`.
- Probe confirms `https://2mrrw.com/api/library/stream?slug=hour-glass` -> `307` to `https://www.2mrrw.com/...`.
- `guest_session` is host-only in practice (no Domain attr; cookie jar shows `www.2mrrw.com`).

### Risk
- Any auth/session initialized on one host may not be available on the other host during redirect hops.

## PHASE 5 — Guest fallback audit

### Findings
- `getGuestUser()` requires valid signed `guest_session` cookie (`src/lib/guest-session.js`).
- Guest session is initialized only via `POST /api/guest/session` (`src/app/api/guest/session/route.js`).
- Without prior initialization (or valid existing cookie), guest fallback is absent.

## PHASE 6 — Exact root cause and safest fix

### Exact session failure point
- 401 is emitted at stream route when both fan session resolution and guest fallback return null.

### Root-cause statement
- Session continuity breaks when server-side auth cookies are unavailable on the effective request host (notably apex<->www transitions), and no valid `guest_session` fallback exists.

### Safest minimal production fix
- Keep auth/session traffic strictly canonical on `https://www.2mrrw.com` for sign-in/callback/navigation entrypoints.
- Keep existing middleware refresh path intact.
- Add targeted 401 diagnostics for fan/guest branch outcomes.
- Ensure guest-init call completes before stream attempt for guest journeys.

## Confirmed vs needs-authenticated-browser-capture

### Confirmed
- 401/403 branch behavior from stream route with and without `guest_session`.
- Apex->www redirect behavior.
- Guest cookie policy and host scope behavior.

### Needs authenticated-browser-capture
- Exact Supabase auth cookie names actually attached for a signed-in failing user on stream request.
- Exact refresh endpoint failure payload for that user/session.
