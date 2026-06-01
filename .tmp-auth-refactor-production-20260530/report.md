# Auth Refactor Production Report — 2026-05-30

## Summary

Centralized all client-side Supabase auth into `src/auth/authService.js` — the sole layer permitted to call `supabase.auth`. Components now route OTP send, verify, sign-out, and session bootstrap through this service with single-flight deduplication, 60s cooldown (memory + localStorage), idempotent requestIds, device-trust session restore, and Strict Mode–safe module-level bootstrap guards.

**Note:** Project is JavaScript-only (no `tsconfig.json`). Service implemented as `authService.js` per project conventions; logic matches the requested `authService.ts` spec.

## Success Criteria Checklist

| Criterion | Status |
|-----------|--------|
| UI pixel-identical | ✅ No style/className/color/layout diffs in auth pages |
| 1 click = 1 OTP request | ✅ Single-flight + idempotency + in-flight refs |
| No duplicate network calls | ✅ Module-level OTP map + requestId dedup |
| Stable session persistence | ✅ bootstrapSession + device trust + onAuthStateChange |
| Strict Mode safe | ✅ Module singleton bootstrap (survives remount) |
| No component calls supabase.auth | ✅ Only authService + server routes |
| Build passes | ✅ `npm run build` exit 0 |
| Foundation smoke (auth-adjacent) | ⚠️ 2 pre-existing anchor/HEAD mismatches (unrelated) |

## Files Changed

| File | Change |
|------|--------|
| `src/auth/authService.js` | **NEW** — centralized auth layer |
| `src/context/AuthContext.js` | Session bootstrap via authService |
| `src/lib/auth/email-otp.js` | Re-export shim → authService |
| `src/app/login/page.js` | authService OTP + fixed missing `otpSendInFlightRef` |
| `src/app/join/page.js` | authService OTP + requestId idempotency |
| `src/app/verify-otp/page.js` | authService verify/resend |
| `src/components/auth/AuthGate.js` | authService verify/send |

## UI Diff Warnings

**None.** Git diff on login, join, verify-otp, and AuthGate contains zero additions to `style`, `className`, colors, spacing, or layout props.

## Allowed Behavior-Only Changes

- Submit disabled while in-flight (existing pattern preserved)
- Double-submit prevention via `otpSendInFlightRef` + authService single-flight
- Login page bugfix: added missing `otpSendInFlightRef` declaration (was ReferenceError)

## Server-Side (Unchanged — Intentional)

These remain direct `supabase.auth` callers (server/middleware, not components):

- `src/lib/auth/session-user.js`
- `src/lib/supabase/middleware.js`
- `src/app/api/auth/complete-profile/route.js`
