# OTP Cooldown UX Alignment Fix — 2026-05-30

## Problem
`verify-otp/page.js` and `AuthGate.js` used a hardcoded 30s `resendIn` countdown. Resend became clickable at 30s while `authService.sendEmailOtp` enforces a 60s cooldown via `getOtpCooldownRemainingMs(email)`. Users saw rate-limit errors with no network call.

## Fix
- Replaced local 30s decrement timers with 500ms polling of `getOtpCooldownRemainingMs(email)`.
- Resend button disabled state and countdown display now derive from authService cooldown (60s).
- Resend handlers guard on `getOtpCooldownRemainingMs(...) > 0` before calling `sendEmailOtp`.
- Client cooldown errors show "Please wait before requesting another code."; Supabase rate limits still use `formatOtpSendError`.

## Files changed
| File | Change |
|------|--------|
| `src/app/verify-otp/page.js` | Cooldown polling, removed `setResendIn(30)`, client cooldown error |
| `src/components/auth/AuthGate.js` | Cooldown polling, removed `setResendIn(30)`, client cooldown error |

## Unchanged
- `src/auth/authService.js` — no structure or logic changes
- Visual design, styling, layout, copy (except optional cooldown error text)
- OTP send flow and auth architecture

## Validation
- `npm run build` — **PASS**
- 30s hardcode removed — confirmed (`grep setResendIn(30)` / `useState(30)` in auth OTP UI: none)
- Style diff check — no new `style` or `className` lines in changed files

## Deliverable
- Zip: `/Users/recharge/Downloads/otp-cooldown-ux-fix-20260530.zip`
