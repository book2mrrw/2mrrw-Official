# Supabase session resolution trace

## End-to-end flow (`getFanSessionUser`)

1. `src/app/api/library/stream/route.js`
   - `const user = await getFanSessionUser() ?? await getGuestUser();`
   - If no user -> `401 Unauthorized`.

2. `src/lib/auth/session-user.js`
   - `getFanSessionUser()` calls `createClient()` from `src/lib/supabase/server.js`.
   - Executes `supabase.auth.getUser()`.
   - If user exists and email is not `@guest.2mrrw.local`, returns normalized profile-backed user.
   - Else falls back to `getGuestUser()` and then `null`.

3. `src/lib/supabase/server.js`
   - `createServerClient(...)` with cookie adapter:
     - `getAll()` -> `cookieStore.getAll()`
     - `setAll(...)` attempts `cookieStore.set(...)`, with server-component-safe catch.

4. `src/lib/supabase/middleware.js`
   - `updateSession(request)` creates SSR client with request cookie adapter.
   - Calls `await supabase.auth.getUser()` to trigger refresh when needed.
   - Writes refreshed cookies back via `supabaseResponse.cookies.set(...)`.

## Conditions where `supabase.auth.getUser()` resolves to no user in this stack

- No Supabase auth cookie arrives with request (first-time user, expired cookies, domain-scope miss).
- Refresh cannot complete in middleware/client flow (missing/invalid refresh token or auth service mismatch).
- Session belongs to synthetic guest identity (`@guest.2mrrw.local`), which this code intentionally excludes from fan session path and routes to guest fallback.
- Auth cookie/session state exists only in local storage (browser-side) but not present server-side at time of server route call.

## Session failure point causing stream 401
- Definitive 401 branch is in stream route after both resolvers return null:
  - `getFanSessionUser()` returns null
  - `getGuestUser()` returns null
  - then `return NextResponse.json({ error: "Unauthorized" }, { status: 401 });`

## Evidence anchors
- `src/app/api/library/stream/route.js`
- `src/lib/auth/session-user.js`
- `src/lib/supabase/server.js`
- `src/lib/supabase/middleware.js`
- `src/lib/guest-session.js`
