# OTP Entry Point Map

**Repo:** artist-platform  
**HEAD:** `04d326fc75080126070d8f8de9944ab95acf9027` (includes `43d37ff` email-intent fix)  
**Scope:** `src/` production code, read-only trace  
**Date:** 2026-05-31

---

## Canonical send (single network choke point)

| # | File | Function | Calls | Auto-fire? |
|---|------|----------|-------|------------|
| **C1** | `src/auth/authService.js` | `sendEmailOtp` → `supabase.auth.signInWithOtp` (L361) | Supabase Auth OTP API | **No** — only when a UI caller invokes `sendEmailOtp` |

**Bypass count:** **0** — no other `signInWithOtp` in `src/`.

**Re-export only (not a caller):** `src/lib/auth/email-otp.js` re-exports `sendEmailOtp` from authService; **zero imports** of `@/lib/auth/email-otp` in `src/`.

---

## UI send entry points (all route through C1)

| # | File | Function | Trigger | User action required? | Auto-fire? | Guards |
|---|------|----------|---------|----------------------|------------|--------|
| **E1** | `src/app/login/page.js` | `submit` (L77) | Form `onSubmit` — "Send Code" | Yes | **No** | `loading`, `otpSendInFlightRef`, `submitRequestIdRef` idempotency, email-change `resetOtpEmailIntent` |
| **E2** | `src/app/join/page.js` | `submit` (L79) | Form `onSubmit` — "Continue" | Yes | **No** | Same as E1 |
| **E3** | `src/components/auth/AuthGate.js` | `sendOtpToEmail` (L157) | Called from below | Yes (via parent handlers) | **No** | `otpSendInFlightRef`, `otpRequestIdRef`, email-change `resetOtpEmailIntent` |
| **E3a** | ↑ | `submitSignup` (L198) | Signup form submit | Yes | **No** | `loading \|\| otpSending` |
| **E3b** | ↑ | `submitSignin` (L227) | Sign-in form submit | Yes | **No** | `loading \|\| otpSending` |
| **E3c** | ↑ | `resendOtp` (L335) | "Resend code" button click | Yes | **No** | `resendIn > 0`, `otpSending`, `otpEmail` present |
| **E4** | `src/app/verify-otp/page.js` | `resendOtp` (L138) | "Resend code" button click | Yes | **No** | `resendIn > 0`, `otpSending`, `otpSendInFlightRef`, `resendRequestIdRef` |

---

## Verify-only paths (NOT OTP send — included for completeness)

| File | Function | Trigger | Auto-fire? | Rate-limit relevance |
|------|----------|---------|------------|---------------------|
| `src/app/verify-otp/page.js` | `verifyOtp` | Form submit + `useEffect` when 8 digits entered | **Yes** (auto-verify on digit 8) | Hits `verifyOtp`, not `signInWithOtp`. Can cause auth 429 storms if misconfigured; **not** "too many code **requests**". |
| `src/components/auth/AuthGate.js` | `verifyOtp` | Same pattern | **Yes** | Same as above |
| `src/auth/authService.js` | `verifyEmailOtp` | Called by verify surfaces | No (caller-driven) | Verify path only |

---

## useEffect / lifecycle audit (send paths)

| File | useEffect | Sends OTP? |
|------|-----------|------------|
| `login/page.js` | Session redirect check (L34); gift preview fetch (L53) | **No** |
| `join/page.js` | sessionStorage hydrate (L38); gift preview (L56) | **No** |
| `AuthGate.js` | `resetForm` on close (L127); `pendingOtpEmail` UI restore (L130); resend countdown (L141) | **No** — pending email only switches to OTP **screen**; does not call `sendEmailOtp` |
| `verify-otp/page.js` | Redirect if no email (L36); resend countdown (L40) | **No** |

**Grep confirmation:** No `useEffect` block in `src/` contains `sendEmailOtp`, `sendOtpToEmail`, or `signInWithOtp`.

---

## Dual auth surfaces (not duplicate sends by themselves)

| Surface | When active | Send entry |
|---------|-------------|------------|
| **Root AuthGate** | `AppAuthRoot` when `authStatus === "unauthenticated"` | E3 / E3a / E3b / E3c |
| **Dedicated pages** | User navigates to `/login`, `/join`, `/verify-otp` | E1, E2, E4 |

Both can exist in DOM (gate overlays shell; pages render underneath). Sends only occur on explicit submit/resend in whichever surface the user interacts with — **not simultaneous auto-send**.

---

## Summary counts

| Metric | Count |
|--------|-------|
| `signInWithOtp` call sites in `src/` | **1** (authService only) |
| Direct `signInWithOtp` bypasses | **0** |
| UI `sendEmailOtp` call sites | **4 files, 6 distinct handler paths** (E1, E2, E3a, E3b, E3c, E4) |
| Auto-send on mount / useEffect | **0** |
| Canonical send functions | **1** (`authService.sendEmailOtp`) |
