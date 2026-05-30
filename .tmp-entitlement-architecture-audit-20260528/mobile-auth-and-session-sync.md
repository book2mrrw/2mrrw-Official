# Mobile Auth and Session Sync

## Mobile/Auth Persistence Model

- Supabase browser client uses persistent session storage key: `2mrrw-auth-token`.
- Auth bootstrap attempts:
  1. `supabase.auth.getSession()`
  2. localStorage recovery fallback (`setSession`) for Safari/ITP cookie drops
  3. fallback to guest session endpoint
- Middleware refreshes Supabase session on most routes (`updateSession` via `supabase.auth.getUser()`).

## Guest vs Authenticated Session Interop

- Guest identity is cookie-signed (`guest_session`) and resolved via admin auth API.
- Authenticated user resolution excludes synthetic guest emails.
- Auth transitions clear guest cookie and refresh account-state.

## Cross-Device Sync Assumptions

- No real-time entitlement push mechanism observed.
- Device B sees changes when it:
  - rehydrates auth/session
  - calls `refreshAccountState` / `refreshLibrary`
  - hits pages/workflows that trigger those refreshes
- Therefore sync is eventually consistent, not immediate.

## Mobile Risk Points

- Safari cookie constraints can cause transient split-brain between localStorage session and cookie-backed server reads.
- Account-state races are mitigated by fetch lock (`accountStateFetchingRef`) but still rely on explicit refresh triggers.
- Event-only entitlement upgrades (`entitlements:updated`) do not guarantee delivery across tabs/devices.
