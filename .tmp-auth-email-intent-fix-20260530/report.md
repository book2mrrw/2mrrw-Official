# OTP Email Intent Isolation Fix — 2026-05-30

## Bug found: **Yes**

Cross-email OTP intent leakage existed in two layers:

1. **Global request-id deduplication** (`otpSeenRequestIds`) keyed only by `requestId`, not by email. After a failed/rate-limited send for email A, reusing the same UI `requestId` (e.g. AuthGate modal close/reopen before `finally`, or stale ref) could silently dedupe a send for email B — no OTP dispatched.
2. **UI in-flight guards** (`otpSendInFlightRef`, `submitRequestIdRef` / `otpRequestIdRef`) were not cleared when the user edited the email field. A prior attempt's lock could block or reuse context for a different address.

Cooldown and localStorage were already correctly scoped per normalized email (`2mrrw-otp-cooldown:{email}`); the leak was in request-id + in-flight state, not cooldown keys.

## Fix (minimal)

### `src/auth/authService.js`
- Scope idempotency keys to `${email}:${requestId}`.
- Export `resetOtpEmailIntent(previousEmail, { requestId })` — clears in-flight flight + scoped requestId for the prior email; **does not** clear that email's cooldown.
- Export `normalizeAuthEmail` for UI comparisons.

### UI (logic only, no visual changes)
- **`src/app/login/page.js`**, **`src/app/join/page.js`**, **`src/components/auth/AuthGate.js`**: `handleEmailChange` calls `resetOtpEmailIntent`, clears refs, and unblocks loading/sending when the normalized email changes.
- **`AuthGate`**: `resetForm` now clears `otpRequestIdRef` on modal close.

### `src/lib/auth/email-otp.js`
- Re-export new authService helpers for backward compatibility.

## Files changed

| File | Change |
|------|--------|
| `src/auth/authService.js` | Email-scoped request ids + `resetOtpEmailIntent` |
| `src/app/login/page.js` | Email-change intent reset |
| `src/app/join/page.js` | Email-change intent reset |
| `src/components/auth/AuthGate.js` | Email-change intent reset + modal reset fix |
| `src/lib/auth/email-otp.js` | Re-exports |

**Not changed:** `verify-otp/page.js` (email comes from URL, not editable).

## Build

```
npm run build — PASS (Next.js 16.2.4)
```

## Manual verification checklist

- [ ] Email A rate-limited → change to email B → Send Code succeeds (no stale block)
- [ ] AuthGate: send for A, close modal mid-flight, reopen, send for B → OTP actually sent
- [ ] Email A still on cooldown after switching away and back → resend correctly blocked for A only
- [ ] Double-click submit for same email still deduped (single network call)
