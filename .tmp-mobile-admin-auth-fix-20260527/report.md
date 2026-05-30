# Mobile admin auth fix — 2026-05-27

## Symptoms

- Desktop: admin recognized (no pricing, full stream).
- Mobile Safari: pricing visible, preview-only playback, admin UI hidden.

## Root cause (file:line)

1. **Auth cookie name mismatch (primary)**  
   - Browser: `src/lib/supabase/client.js` — `createBrowserClient` with `auth.storageKey: "2mrrw-auth-token"` writes session cookies under that name.  
   - Server/middleware: `src/lib/supabase/server.js`, `src/lib/supabase/middleware.js` — `createServerClient` with **no** `storageKey`, so `getFanSessionUser()` / `supabase.auth.getUser()` read default `sb-<project-ref>-auth-token` cookies.  
   - Result: client could hold a valid OTP session while `/api/account/state` and `/api/library/stream` saw **no** Supabase user.

2. **Stale `guest_session` wins server identity (secondary)**  
   - `src/lib/auth/session-user.js:30-31` — when Supabase cookies are absent, `getFanSessionUser()` falls back to `getGuestUser()`.  
   - `src/context/AuthContext.js` — after client bootstrap set admin from session, `refreshAccountState()` applied guest payload and cleared `isAdmin` / `permissions.admin`.

Prior commit `b8445b7` moved the browser client to `createBrowserClient` but did not align server/middleware cookie keys.

## Fix summary

| Change | Purpose |
|--------|---------|
| `src/lib/supabase/auth-storage-key.js` | Single `SUPABASE_AUTH_STORAGE_KEY` constant |
| `client.js`, `server.js`, `middleware.js` | Same `auth.storageKey` on browser + server |
| `guest-session.js` + `account/state/route.js` | Clear `guest_session` when returning authenticated fan |
| `AuthContext.js` | Clear guest on fan login; do not downgrade admin on guest-shaped server payload; preserve `accountState.permissions.admin` during stale responses |

## Files changed

- `src/lib/supabase/auth-storage-key.js` (new)
- `src/lib/supabase/client.js`
- `src/lib/supabase/server.js`
- `src/lib/supabase/middleware.js`
- `src/lib/guest-session.js`
- `src/app/api/account/state/route.js`
- `src/context/AuthContext.js`

## Verification

- `npm run build` — passed (Next.js 16.2.4)

## Git / deploy

- Commit: `fix(auth): consistent admin detection and entitlements on mobile Safari`
- SHA: see `manifest.txt`

## Manual test (mobile Safari)

1. Sign out, clear site data (or use private tab).
2. OTP login as admin (`book2mrrw@gmail.com`).
3. Confirm DevTools → Application → Cookies: `2mrrw-auth-token` (chunked) present on `www.2mrrw.com`.
4. Confirm `/api/account/state` returns `permissions.admin: true`, no pricing on catalog, full stream (not preview).
