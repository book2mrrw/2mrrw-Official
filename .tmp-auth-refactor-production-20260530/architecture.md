# authService Architecture

## Location

`src/auth/authService.js` — single client-side Supabase auth boundary.

## Design Principles

1. **One front door** — components import `@/auth/authService`; never `@/lib/supabase/client` for auth.
2. **Explicit user action only** — OTP sends happen in click/submit handlers, never mount effects.
3. **Fail closed on rate limits** — no auto-retry; cooldown enforced client-side before network.
4. **Strict Mode immunity** — module-level singletons survive React 18 double-mount.

## Public API

| Export | Purpose |
|--------|---------|
| `bootstrapSession()` | One-time getSession + localStorage restore + onAuthStateChange wiring |
| `subscribeAuthState(cb)` | AuthContext listener; returns unsubscribe |
| `getAuthenticatedUser()` | Read-only redirect guard for login/join |
| `sendEmailOtp({ email, shouldCreateUser, requestId })` | Hardened OTP send |
| `verifyEmailOtp({ email, token, type })` | OTP verification |
| `signOut()` | Sign out + clear device trust |
| `getOtpCooldownRemainingMs(email)` | UI countdown support |
| `formatOtpSendError(err)` | User-facing error strings |
| `isOtpRateLimitError(err)` | Rate-limit detection |

## OTP Hardening Layers

```
User click/submit
    │
    ▼
Component in-flight ref (UI guard)
    │
    ▼
requestId idempotency map ──► duplicate requestId → silent success
    │
    ▼
60s cooldown (memory + localStorage) ──► block before network
    │
    ▼
single-flight Map<email, Promise> ──► concurrent calls share one request
    │
    ▼
supabase.auth.signInWithOtp (ONLY here)
```

## Session Bootstrap Flow

```
bootstrapSession() [module singleton]
    │
    ├─► supabase.auth.getSession()
    │
    ├─► device trust in localStorage?
    │       └─► restoreSessionFromStorage() via setSession
    │
    ├─► markDeviceAuthenticated on success
    │
    └─► onAuthStateChange (once) → fan-out to subscribeAuthState listeners
```

## Device Trust

- Key: `2mrrw-device-session` in localStorage
- Stores `{ userId, at }` after successful auth
- On bootstrap without cookie session, trusted devices attempt localStorage token restore first (Safari ITP mitigation)
- Cleared on SIGNED_OUT / signOut()

## Storage Keys

| Key | Purpose |
|-----|---------|
| `2mrrw-auth-token` | Supabase session (existing) |
| `2mrrw-device-session` | Device trust marker |
| `2mrrw-otp-cooldown:{email}` | OTP cooldown expiry timestamp |

## Integration Points

- **AuthContext** — `bootstrapSession()` + `subscribeAuthState()` + `signOut()`
- **login/join** — `sendEmailOtp()` with per-submit `requestId`
- **verify-otp / AuthGate** — `verifyEmailOtp()` + resend via `sendEmailOtp()`
- **email-otp.js** — deprecated re-export shim for backward compatibility
