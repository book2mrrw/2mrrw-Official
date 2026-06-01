# Auth Stability Audit — Detailed Findings

**Audit ID:** auth-stability-audit-20260530  
**Repository:** `/Users/recharge/artist-platform`

---

## 1. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  UI surfaces                                                 │
│  login/page.js  join/page.js  verify-otp/page.js  AuthGate  │
└──────────────────────────┬──────────────────────────────────┘
                           │ sendEmailOtp / verifyEmailOtp /
                           │ getAuthenticatedUser / signOut
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  authService.js (ONLY client supabase.auth caller)           │
│  • bootstrapSession (module singleton)                       │
│  • onAuthStateChange → authListeners Set                     │
│  • OTP: single-flight, cooldown, requestId dedup             │
└──────────────────────────┬──────────────────────────────────┘
                           │ subscribeAuthState
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  AuthContext.js                                              │
│  • bootstrap → setUser / refreshGuest                        │
│  • SIGNED_IN / SIGNED_OUT → applySessionUser / clear         │
│  • Entitlements via /api/account/state                       │
└─────────────────────────────────────────────────────────────┘
```

**Server auth:** `lib/supabase/server.js`, `lib/auth/session-user.js`, API routes use `getUser()` — separate from client layer (correct).

---

## 2. File-by-file findings

### `src/auth/authService.js` — HEALTHY

| Area | Finding | Severity |
|------|---------|----------|
| Singleton Supabase client | Module-level `supabaseSingleton` | OK |
| Bootstrap | `bootstrapPromise` + `bootstrapComplete` Strict Mode safe | OK |
| Auth listener | Single `onAuthStateChange`, fan-out via `authListeners` Set | OK |
| OTP send | Single-flight Map, 60s cooldown (mem + localStorage), requestId idempotency | OK |
| Cooldown tamper | `sanitizeCooldownUntil` rejects runaway timestamps | OK |
| Device trust | UX-only; cleared on user mismatch / SIGNED_OUT | OK |
| Session restore | Manual localStorage read for ITP fallback | Monitor (advisory #4) |

**Direct `supabase.auth` calls (client):** `getSession`, `setSession`, `onAuthStateChange`, `signInWithOtp`, `verifyOtp`, `signOut` — all in this file only.

---

### `src/context/AuthContext.js` — FIXED

| Area | Finding | Severity |
|------|---------|----------|
| Strict Mode | **BUG:** Early return skipped re-subscribe after cleanup | **HIGH (dev)** → **FIXED** |
| Bootstrap | Module singleton prevents double network bootstrap | OK |
| SIGNED_IN handler | Skips if `signedInUserIdRef` matches (prevents duplicate apply) | OK |
| TOKEN_REFRESHED | Ignored (no entitlement flash) | OK |
| Guest vs auth | `resolveUserFromSession` filters `@guest.2mrrw.local` | OK |
| Account fetch | `accountStateFetchingRef` single-flight | OK |
| 401 handling | Clears state on account/state 401 | OK |

**Change applied:** Bootstrap guarded by ref; subscription always registered.

---

### `src/app/login/page.js` — FIXED

| Area | Finding | Severity |
|------|---------|----------|
| Session guard | `getAuthenticatedUser()` redirect if already signed in | OK |
| OTP send | `shouldCreateUser: false`, requestId, in-flight ref | OK |
| verify-otp nav | **BUG:** Missing `createUser=0` for resend path | **MEDIUM** → **FIXED** |
| Double submit | `loading` + `otpSendInFlightRef` + authService guards | OK |

---

### `src/app/join/page.js` — HEALTHY

| Area | Finding | Severity |
|------|---------|----------|
| OTP send | `shouldCreateUser: true` | OK |
| verify-otp nav | Default `createUser` true on verify page matches | OK |
| Pending profile | sessionStorage for name/phone | OK |
| No session redirect guard | Join allows authenticated users (may be intentional) | Low / advisory |

---

### `src/app/verify-otp/page.js` — HEALTHY (1 advisory)

| Area | Finding | Severity |
|------|---------|----------|
| Auto-submit | `otpAutoSubmittedRef` prevents double verify | OK |
| Verify guard | `verifyInFlightRef` + `otpLoading` | OK |
| Resend | requestId, in-flight ref, authService cooldown | OK |
| Resend UI timer | 30s vs 60s service cooldown | Low (advisory #1) |
| Post-verify | `applySessionUser` + extra `refreshAccountState` | Low (advisory #3) |
| createUser param | Reads from URL; fixed upstream for login | OK after fix |

---

### `src/components/auth/AuthGate.js` — HEALTHY

| Area | Finding | Severity |
|------|---------|----------|
| OTP paths | Uses authService exclusively | OK |
| sendOtpToEmail | Single-flight via `otpSendInFlightRef` + authService | OK |
| Signup flow | `checkEmailExists` → dynamic `shouldCreateUser` | OK (in-modal, no URL param needed) |
| Resend | Delegates to `sendOtpToEmail` with stored `otpCreateUser` | OK |
| Reset on close | Clears most refs; minor incomplete reset | Low (advisory #6) |

---

### `src/lib/auth/email-otp.js` — DEPRECATED SHIM

Re-exports from `@/auth/authService`. No duplicate logic. No imports found elsewhere in `src/` (grep clean).

---

## 3. Grep sweep — `supabase.auth` in `src/`

| Location | Context | Client? |
|----------|---------|---------|
| `auth/authService.js` | All client auth ops | Yes — canonical |
| `lib/supabase/middleware.js` | `getUser()` | Server middleware |
| `lib/auth/session-user.js` | `getUser()` | Server |
| `app/api/auth/complete-profile/route.js` | `getUser()` | Server |

**Result:** No stray client-side `supabase.auth` bypass of authService.

---

## 4. Verification matrix (pre/post fix)

### Duplicate auth listeners

- **Before:** 1 Supabase listener (OK); AuthContext could have 0 listeners after Strict Mode remount (BAD)
- **After:** Always exactly 1 Supabase listener + 1 AuthContext subscriber when provider mounted

### Session race conditions

- Bootstrap: serialized via `bootstrapPromise`
- OTP: serialized per-email via `otpFlights`
- Account state: serialized via `accountStateFetchingRef`
- SIGNED_IN vs manual applySessionUser: guarded by `signedInUserIdRef`

### Cross-tab session conflicts

- Shared `SUPABASE_AUTH_STORAGE_KEY` (`2mrrw-auth-token`)
- Supabase emits storage events → `onAuthStateChange` in all tabs
- Custom restore only when `getSession()` empty (ITP fallback)

### OTP trigger safety

| Guard | login | join | verify-otp resend | AuthGate |
|-------|-------|------|-------------------|----------|
| in-flight ref | ✓ | ✓ | ✓ | ✓ |
| requestId | ✓ | ✓ | ✓ | ✓ |
| authService cooldown | ✓ | ✓ | ✓ | ✓ |
| authService single-flight | ✓ | ✓ | ✓ | ✓ |
| shouldCreateUser correct | ✓ | ✓ | ✓ (after fix) | ✓ |

### Single source of truth

- Auth proof: Supabase session only
- Entitlements: `/api/account/state` → `AuthContext`
- Guest: `/api/guest/session` separate cookie path
- Device trust localStorage: never used for auth decisions in AuthContext

### Strict Mode

- `authService`: module-level guards survive remount ✓
- `AuthContext`: fixed to re-subscribe ✓
- Login/join/verify: ref guards per submit (component remount resets refs — OK for forms)

---

## 5. Lines changed (exact)

### `src/context/AuthContext.js`

- Removed early `if (sessionBootstrappedRef.current) return` wrapping entire effect
- Wrapped bootstrap async IIFE in `if (!sessionBootstrappedRef.current)` block
- Added `else if (mounted) setLoading(false)` for Strict Mode remount
- Added comment: "Always subscribe — Strict Mode cleanup must not leave the app without auth listeners"

### `src/app/login/page.js`

- Added `createUser: "0"` to `URLSearchParams` before `router.push('/verify-otp?...')`

---

## 6. Risk assessment (production)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Auth listener missing after dev Strict Mode | Was HIGH in dev | Missed sign-out/sync | **Fixed** |
| Login resend creates user | Was MEDIUM | Wrong Supabase path | **Fixed** |
| OTP rate limit UX confusion | LOW | User frustration | Advisory #1 |
| ITP manual restore race | LOW | Stale session flash | Existing guards + monitor |

**Production runtime:** Strict Mode double-mount does not occur in production builds; Fix 1 primarily hardens dev/staging parity. Fix 2 affects live login resend behavior.
