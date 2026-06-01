# Device Trust Logic Review

**Key:** `2mrrw-device-session` (localStorage)  
**Shape:** `{ userId: string, at: number }`

## Purpose (UX only)

Marks that this browser completed a real Supabase login on this device. Used to:

- Label bootstrap source (`localStorage-trusted` vs `localStorage`)
- Prioritize restore messaging for Safari ITP cookie loss

It is **not** a credential and is **not** read by `AuthContext` for entitlements or `authStatus`.

## Flow audit

### Write paths

| Function | When |
|----------|------|
| `markDeviceAuthenticated(session)` | After valid `session` from bootstrap, `verifyEmailOtp`, `onAuthStateChange` with `nextSession` |
| Requires | `session?.user?.id` — no write without Supabase user |

### Read paths

| Function | Behavior |
|----------|----------|
| `readDeviceTrust()` | Parse JSON marker only |
| `bootstrapSession()` | If no cookie session → `restoreSessionFromStorage()` → `supabase.auth.setSession` with tokens from `2mrrw-auth-token` |

### Clear paths

| Trigger | Action |
|---------|--------|
| `signOut()` | `clearDeviceTrust()` |
| `SIGNED_OUT` event | `clearDeviceTrust()` |
| Stale userId mismatch after restore | `clearDeviceTrust()` (fix applied) |

## Verification checklist

| # | Requirement | Result |
|---|-------------|--------|
| 1 | Does NOT bypass Supabase authentication checks | **PASS** — `setSession` validates tokens with Supabase |
| 2 | ONLY used for UX/session preference | **PASS** — marker never passed to `AuthContext` |
| 3 | Cannot auto-authenticate without valid Supabase session | **PASS** — no session without successful `setSession` |
| 4 | Cannot create false "logged in" state | **PASS** — `authStatus` uses `resolveUserFromSession(session)` only |

## Security notes

- Setting `2mrrw-device-session` alone does **not** grant access; attacker still needs valid `access_token` + `refresh_token` in `2mrrw-auth-token`.
- `AuthContext` never sets `user` from device trust; only from `resolvedSession` or `/api/account/state` / guest API.
- `getAuthenticatedUser()` uses `bootstrapSession()` → session user only.

## Fix applied

When restore succeeds but `deviceTrust.userId !== session.user.id`, clear stale trust marker so UX metadata cannot imply the wrong account.
