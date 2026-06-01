# Duplicate OTP Triggers — Root Causes & Fixes

## Root Causes Identified

### 1. Scattered `supabase.auth.signInWithOtp` calls
Four independent call sites (login, join, verify-otp resend, AuthGate) each invoked Supabase directly with only local component-level guards. No cross-component deduplication.

**Fix:** All sends route through `authService.sendEmailOtp()` with global single-flight map keyed by normalized email.

### 2. Missing in-flight ref on login page
`src/app/login/page.js` referenced `otpSendInFlightRef` without declaring it — guard was a no-op, allowing double-submit.

**Fix:** Added `useRef(false)` + `submitRequestIdRef` for idempotency.

### 3. Enter + click double-fire
Form submit handlers could fire twice (button click + Enter key) before React state `loading` updated.

**Fix:** Synchronous `otpSendInFlightRef.current = true` before await + authService requestId dedup (same id → silent no-op).

### 4. No global cooldown
Resend across pages (login → verify-otp → AuthGate) had independent 30s UI timers but no shared cooldown. User could hit rate limits by navigating between surfaces.

**Fix:** 60s cooldown in authService memory + localStorage, enforced before any network call.

### 5. React 18 Strict Mode session double-bootstrap
AuthContext used `sessionBootstrappedRef` which resets on Strict Mode remount, potentially re-running getSession/setSession/onAuthStateChange.

**Fix:** Module-level `bootstrapPromise` + `bootstrapComplete` in authService — survives remounts.

### 6. Concurrent resend + initial send
AuthGate `sendOtpToEmail` and signup/signin submit could overlap if user tapped quickly.

**Fix:** Single-flight promise per email; second caller awaits same promise instead of firing new request.

## What Was NOT Changed

- OTP auto-submit on 8 digits (verify screens) — user-entered code completion, not OTP send
- 30s resend UI countdown — visual only; backend cooldown is 60s via authService
- Server-side auth routes — unchanged

## Verification

- Grep confirms zero `supabase.auth` in `src/app/` and `src/components/` after refactor
- Only `src/auth/authService.js` calls client-side Supabase auth APIs
