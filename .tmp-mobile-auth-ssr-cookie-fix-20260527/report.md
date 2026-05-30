# Mobile auth SSR cookie fix — 2026-05-27

## What was broken

The browser Supabase client (`src/lib/supabase/client.js`) used `createClient` from `@supabase/supabase-js` with `localStorage` (or an in-memory fallback). OTP login and session refresh therefore persisted tokens only in browser storage.

Server routes and middleware use `@supabase/ssr` `createServerClient`, which reads and writes **HTTP cookies** on each request. On mobile Safari, after OTP verify the client held a valid session in `localStorage` while the server still saw a **guest** (no auth cookies on `/api/account/state`, stream, etc.).

Foundation docs and audits already expected `createBrowserClient` for `client.js`; production code had diverged.

## What changed

**File:** `src/lib/supabase/client.js`

- Replaced `createSupabaseClient` + `getBrowserStorage()` / `memoryLocalStorageAdapter` with `createBrowserClient` from `@supabase/ssr`.
- Preserved auth options: `storageKey: "2mrrw-auth-token"`, `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: true`, `flowType: "pkce"`.
- Removed explicit `storage: localStorage` so the SSR client uses its default cookie-backed storage (`document.cookie` in the browser).

No changes to middleware, verify-otp page, AuthContext, playback, entitlements, route handlers, or UI.

## How it works now

1. User completes OTP (or magic link) via `createClient()` from `@/lib/supabase/client`.
2. `createBrowserClient` encodes the session in **chunked HTTP cookies** (same transport model as `createServerClient` in middleware/server).
3. Root `middleware.js` → `updateSession` refreshes cookies on navigation.
4. Server APIs (`getFanSessionUser`, `/api/account/state`, `/api/library/stream`) read the same cookie session — mobile Safari matches desktop.

`createBrowserClient` still uses PKCE, auto-refresh, and the `2mrrw-auth-token` storage key for chunk naming consistency with prior localStorage key hints.

## Files touched

| File | Action |
|------|--------|
| `src/lib/supabase/client.js` | Updated to `createBrowserClient` |

## Verification (read-only)

### Unchanged (confirmed)

- `src/lib/supabase/middleware.js` — `updateSession` still uses `createServerClient` + request/response cookie bridge.
- `src/app/verify-otp/page.js` — still imports `createClient` from `@/lib/supabase/client` and calls `verifyOtp` (now cookie-backed via updated client).

### Grep: browser auth imports

All client auth surfaces use `@/lib/supabase/client`:

- `src/context/AuthContext.js` (dynamic import)
- `src/components/auth/AuthGate.js`
- `src/app/join/page.js`
- `src/app/login/page.js`
- `src/app/verify-otp/page.js`

### Grep: `@supabase/supabase-js` in `src/` (expected server-only)

| File | Role |
|------|------|
| `src/lib/supabase/admin.js` | Service role admin client |
| `src/app/api/save-purchase/route.js` | Server API |
| `src/app/api/get-purchases/route.js` | Server API |
| `src/app/api/register-user/route.js` | Server API |

No browser auth file imports `createClient` from `@supabase/supabase-js` directly.

### Build

`npm run build` — **passed** (Next.js 16.2.4, exit 0).

### Git

- Commit message: `fix(auth): use createBrowserClient from @supabase/ssr for cookie-based session on mobile Safari`
- Branch: `main`, pushed to `origin/main`
