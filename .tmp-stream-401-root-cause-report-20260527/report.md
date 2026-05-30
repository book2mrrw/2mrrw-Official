# /api/library/stream 401 Root-Cause Trace Report

- Trace task id: `8e74c7ac-ccef-459f-8b8b-e023a1009739`
- Source transcript: `agent-transcripts/22ed5f23-e4b1-454c-aaaa-196208826de1/subagents/8e74c7ac-ccef-459f-8b8b-e023a1009739.jsonl`
- Workspace: `/Users/recharge/artist-platform`
- Repository branch at packaging time: `main`

## Exact 401-producing branch references

`GET /api/library/stream` has one effective 401 source during playback: user identity resolution fails before entitlement runs.

1) **Exact 401-producing branch (file:line + condition)**

- `src/app/api/library/stream/route.js:109-112`
  - Condition: `const user = await getFanSessionUser() ?? await getGuestUser(); if (!user) return 401`
  - This is the branch that matches production symptom (`{"error":"Unauthorized"}`).
- Also present for `DELETE` only (not playback): `src/app/api/library/stream/route.js:141-144`.

2) **Exact missing credential/session/entitlement element**

- Missing element for this 401 is **resolved server user identity** (neither fan session nor guest session).
- Identity chain:
  - `getFanSessionUser()` (`src/lib/auth/session-user.js:5-33`) uses server Supabase client + `supabase.auth.getUser()`.
  - If no valid non-guest Supabase user, it falls back to `getGuestUser()`.
  - `getGuestUser()` (`src/lib/guest-session.js:100-120`) requires valid `guest_session` cookie and resolvable auth user ID.
- So 401 occurs when request lacks/has-invalid:
  - Supabase auth session cookies visible server-side, and
  - `guest_session` cookie fallback.

3) **Request config vs session refresh vs entitlement mismatch**

- **Client request config:**
  - `src/lib/playback/stream-client.js:66-68` uses relative same-origin URL + `credentials: "include"`.
  - No code path here strips cookies.
- **Middleware/session refresh dependency:**
  - `middleware.js:10-20` applies to `/api/library/stream` (not excluded by matcher).
  - `src/lib/supabase/middleware.js:26` calls `supabase.auth.getUser()` on each matched request (Supabase SSR refresh path).
  - Stream route also calls `supabase.auth.getUser()` via `getFanSessionUser()`.
  - If refresh cannot produce a valid user (or cookies are absent), route falls through to guest; if guest missing too => 401.
- **Entitlement mismatch is not this 401:**
  - 403 branch is separate: `src/app/api/library/stream/route.js:40-44` when `userCanStreamProduct(...)` is false.

4) **Slug branch outcomes (`hour-glass` vs `hourglass`)**

- Without cookies (production probe), both slugs return the same 401 because auth gate runs first.
- For authenticated non-admin users, slug typo can look auth-related but is actually entitlement failure:
  - `userCanStreamProduct` (`src/lib/commerce/entitlements.js:94-123`) checks ownership/membership/collector + product existence.
  - If slug does not map to an eligible product, returns false -> stream route returns 403.
  - So `hourglass` (no hyphen) can produce perceived access denial after auth, but not the unauthenticated 401 branch.

## Probe outcomes (runtime evidence)

Unauthenticated curl results from production:

- `GET https://www.2mrrw.com/api/library/stream?slug=hour-glass` -> `401` body `{"error":"Unauthorized"}`
- `GET https://www.2mrrw.com/api/library/stream?slug=hour-glass&redirect=1` -> `401` same body
- `GET https://www.2mrrw.com/api/library/stream?slug=hourglass` -> `401` same body
- `GET https://www.2mrrw.com/api/library/stream?slug=hourglass&redirect=1` -> `401` same body

## Precise runtime root cause

The observed 401 is caused by **failure to resolve any server-side user context** at `src/app/api/library/stream/route.js:109-112` (no valid Supabase server session user and no valid `guest_session` fallback), not entitlement logic.

## Minimal production-safe next verification step

Capture one failing browser-authenticated stream request in DevTools Network for `/api/library/stream?slug=hour-glass` and verify request cookies include either:

- Supabase auth cookies (server-readable session), or
- `guest_session`.

If response is still 401 with missing cookies, this confirms session transport/refresh-cookie continuity issue; if cookies are present, inspect whether Supabase `getUser()` returns null for that cookie set.
