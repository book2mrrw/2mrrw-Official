# Auth Safety Audit — Final Report

**Date:** 2026-05-30  
**Scope:** Supabase auth refactor — `src/auth/authService.js`, `src/context/AuthContext.js`, full `src/` grep  
**Build:** `npm run build` — **PASS** (exit 0)

## Verdict: **PASS**

All three strict guarantees hold after fixes. No Supabase auth bypass paths found in client code.

## Issues

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Medium | Tampered `2mrrw-otp-cooldown:{email}` could store a far-future timestamp → de facto permanent OTP lockout | **Fixed** |
| 2 | Low | Stale `2mrrw-device-session` userId could diverge from restored token user (UX confusion, not auth bypass) | **Fixed** |

**Issues found:** 2  
**Fixes applied:** 2  
**Critical bypasses:** 0

## Fixes applied

### `src/auth/authService.js`

1. **`sanitizeCooldownUntil()`** — Cooldown uses expiry timestamps only; values beyond `now + OTP_COOLDOWN_MS + skew` are rejected; expired/malformed keys removed from localStorage on read.
2. **`getCooldownUntil()`** — Prunes expired in-memory cooldown entries.
3. **`bootstrapSession()`** — Single restore path; device trust only affects source label; clears stale device trust when restored `session.user.id` ≠ stored trust `userId`.
4. **Inline SAFETY comments** on device trust and cooldown.

### `src/context/AuthContext.js`

1. **Inline SAFETY comment** — User state derives only from Supabase session via `bootstrapSession`, not device-trust localStorage.

## Grep: client `supabase.auth` usage

| Location | Role |
|----------|------|
| `src/auth/authService.js` | **Only** client-side `supabase.auth.*` — centralized layer |
| `src/lib/auth/session-user.js` | Server `getUser()` |
| `src/lib/supabase/middleware.js` | Server `getUser()` |
| `src/app/api/auth/complete-profile/route.js` | Server `getUser()` |

No client bypass of `authService` detected.

## Final safety confirmation

- **Device trust** does not bypass Supabase checks; cannot auto-login without valid tokens + `setSession` success.
- **OTP cooldown** is time-based (60s), resets after expiry, cannot permanently lock out after sanitization.
- **Supabase session** remains the single source of truth for authenticated UI state (`resolveUserFromSession` → `applySessionUser` / `authStatus`).
