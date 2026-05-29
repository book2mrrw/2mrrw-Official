# Stream 403 fix — admin entitlement on `/api/library/stream`

**Date:** 2026-05-28  
**Issue:** `HEAD /api/library/stream?slug=w2d&redirect=1 → 403` for admin `book2mrrw@gmail.com` with valid `2mrrw-auth-token` cookie.

## Prompt requirements

1. Handle HEAD on stream route (same entitlement as GET)
2. Admin must pass entitlement for every slug without per-slug purchase lookup
3. Confirm `redirect=1` proxies audio after entitlement passes
4. Do not rewrite entitlement architecture, UI, AudioContext, or auth OTP
5. Preserve r2-stream-proxy, media-cors, entity-folder paths, features resolver, site-api-url
6. `npm run build` must pass

## Root cause

The 403 came from `validateStreamEntitlement` → `userCanStreamProduct`, not from R2 or CORS.

Two gaps caused admin recognition to fail for authenticated sessions:

1. **Profile email shadowing auth email** — `getFanSessionUser()` sets `email: profile?.email || user.email`. When `profiles.email` differs from the Supabase auth email (`book2mrrw@gmail.com`), `isAdminUser(user)` only checked the profile email and returned false.

2. **Profile admin lookup skipped when user object present** — `userCanStreamProduct` only queried `profiles` for admin when `user === null`. Stream route always passes the session user, so a DB `role: admin` or canonical profile email was never consulted after a failed session-object check.

The stream client sends **HEAD** probes to `redirect=1` URLs (`assertSignedAudioUrl` in `stream-client.js`). HEAD was already wired (`export const HEAD = GET`), but failed at the same entitlement gate.

## Fix summary

| Layer | Change |
|-------|--------|
| `isAdminUser` | Accept `authEmail` (Supabase auth email) in addition to display `email` |
| `getFanSessionUser` | Attach `authEmail: user.email` to session user |
| `userCanStreamProduct` | Always reconcile admin from `profiles` when session admin check fails |
| `validateStreamEntitlement` | Fast-path `isAdminUser(user)` before async entitlement work |

`redirect=1` behavior unchanged: after entitlement, `proxySignedR2Get` forwards GET/HEAD (with Range) through Next.js — no R2 redirect.

## Files changed

See `files-changed.md`.

## Verification

See `verification-results.md`. Build passed locally.
