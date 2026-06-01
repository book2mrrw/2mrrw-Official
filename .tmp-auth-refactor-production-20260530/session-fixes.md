# Session Management Fixes

## Problems Addressed

1. **Unstable session on refresh** — bootstrap logic was inline in AuthContext with component-scoped refs
2. **Safari ITP cookie loss** — localStorage fallback existed but ran on every mount in Strict Mode
3. **Re-auth loops** — TOKEN_REFRESHED and INITIAL_SESSION events could trigger redundant account state fetches
4. **Logout on tab switch** — missing centralized listener lifecycle

## Fixes Applied

### Centralized bootstrap (`authService.bootstrapSession`)

- Single module-level promise ensures getSession runs once per page load
- localStorage session restore via `setSession` when cookies missing
- Device trust prioritization: if `2mrrw-device-session` exists, attempt restore before guest fallback

### Auth state listener consolidation

- `onAuthStateChange` registered once inside authService
- AuthContext uses `subscribeAuthState()` — no duplicate Supabase subscriptions
- Events handled:
  - `SIGNED_OUT` → clear local auth state
  - `TOKEN_REFRESHED` / `INITIAL_SESSION` → silent (no re-fetch loop)
  - `SIGNED_IN` → apply session only if userId changed

### Device trust (logical, no UI)

```json
// localStorage: 2mrrw-device-session
{ "userId": "...", "at": 1717000000000 }
```

- Written on successful session restore, verify, or auth state change with session
- Cleared on signOut / SIGNED_OUT
- Enables prioritized localStorage restore for returning devices

### Silent reauth

Background token refresh (`TOKEN_REFRESHED`) no longer triggers `applySessionUser` or account state re-fetch — prevents login gate flash during normal session renewal.

### AuthContext changes

- Removed direct `createClient()` / `supabase.auth.*` imports
- Uses `bootstrapSession()` + `subscribeAuthState()` + `authSignOut()`
- Component ref guard retained as secondary protection; primary guard is module singleton

## Server Session (Unchanged)

Server routes continue using `@/lib/supabase/server` createClient — appropriate separation of client/server auth boundaries per Next.js App Router patterns.
