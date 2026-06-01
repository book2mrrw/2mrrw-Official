# Strict Guarantee Checklist

## Guarantees

| Guarantee | Status | Evidence |
|-----------|--------|----------|
| Device trust NEVER bypasses auth security | **HOLD** | Trust marker only gates restore *attempt*; session requires `setSession` with valid tokens |
| OTP cooldown NEVER becomes permanent lockout | **HOLD** | Timestamp-based 60s window + sanitization + storage cleanup |
| Supabase session ALWAYS source of truth | **HOLD** | `AuthContext` sets user only via `resolveUserFromSession(session)` or server `/api/account/state` |
| No hidden auth bypass paths | **HOLD** | Grep: client `supabase.auth.*` only in `authService.js` |
| No unintended auto-login without valid session | **HOLD** | Bootstrap + listeners require `session` with real user; guest path separate |

## AuthContext paths reviewed

| Path | Session required? |
|------|-------------------|
| Initial `bootstrapSession` → `applySessionUser` | Yes |
| `subscribeAuthState` `SIGNED_IN` | Yes |
| `TOKEN_REFRESHED` / `INITIAL_SESSION` | No user mutation (no false login) |
| `SIGNED_OUT` | Clears user |
| `refreshGuest` | Guest API only when no Supabase user |
| `authStatus` | Derived from `user` + guest flags |

## Hidden bypass scan (`src/`)

| Pattern | Matches | Risk |
|---------|---------|------|
| `supabase.auth` (client) | `authService.js` only | None |
| `2mrrw-device-session` reads outside authService | None | None |
| Direct OTP without authService | All UI uses `sendEmailOtp` / `verifyEmailOtp` exports | None |
| `AuthGateContext.isAuthenticated: true` | Stub unused by `AppAuthRoot` (uses `authStatus`) | None — out of scope |

## Server auth (informational)

Server routes correctly use `createClient()` + `getUser()` — not client bypass; entitlements still from `/api/account/state`.

## Post-fix confirmation

All three task guarantees hold. Build verified. No UI/styling changes.
