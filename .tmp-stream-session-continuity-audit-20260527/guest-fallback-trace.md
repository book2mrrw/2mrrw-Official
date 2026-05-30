# Guest fallback trace

## `getGuestUser()` path
- `src/lib/guest-session.js` -> `getGuestIdFromCookie()` reads `guest_session` cookie.
- If cookie missing/invalid signature, returns null.
- If present, server queries Supabase Admin `auth.admin.getUserById(guestId)`.
- If found, returns guest user object used by stream/account routes.

## Session initialization path
- `POST /api/guest/session` (`src/app/api/guest/session/route.js`):
  - calls `createOrRetrieveGuest(...)`
  - responds with `withGuestCookie(...)` to set `guest_session`.

## Why guest fallback may be absent at stream time
- User never called guest session init endpoint (`/api/guest/session` POST).
- Cookie expired/deleted/not included due host mismatch (`www` vs apex) or browser policy.
- Cookie signature invalid (tampered/corrupted), causing decode failure.
- Guest user row missing/unavailable in Supabase admin lookup.

## Fallback dependency
- Yes: fallback requires prior initialization that sets `guest_session` cookie (or previously persisted valid cookie).

## Probe evidence
- Without guest cookie: stream returns 401.
- After `POST /api/guest/session` and replaying cookie: stream returns 403 (authenticated as guest but not entitled).
