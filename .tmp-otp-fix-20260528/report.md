# OTP auto-trigger fix — 2026-05-28

## 1. Where OTP was auto-triggered

| Location | Behavior | Send vs verify |
|----------|----------|----------------|
| `src/components/auth/AuthGate.js` | `useEffect` when 8 digits entered → `void verifyOtp()` | **Verify** (not send), but on failure reset `otpAutoSubmittedRef` → **infinite verify retry loop** hitting Supabase auth |
| `src/app/verify-otp/page.js` | Same auto-verify `useEffect` | Same retry loop |
| `src/components/auth/AuthGate.js` | `useEffect` on `open` reads `pendingOtpEmail` from sessionStorage | **UI only** (OTP screen, no `signInWithOtp`) — could confuse users into tapping Resend; did not auto-send in code |
| `src/context/AuthContext.js` | `onAuthStateChange` | No OTP send; duplicate `SIGNED_IN` could re-run `applySessionUser` / account refresh |
| `src/app/join/page.js`, `src/app/login/page.js` | Submit handlers only | Send on form submit (blocked by `AppAuthRoot` when gate active) |
| Middleware | `getUser()` only | No OTP |

**Not found:** `signInWithOtp` / `sendEmailOtp` inside any `useEffect` on mount (grep clean after fix).

## 2. Cause of repeated requests

1. **Primary:** Auto-verify effects re-fired after failed verification because `otpAutoSubmittedRef` was cleared in `catch`, while `code` stayed at 8 digits → tight loop of `verifyOtp` calls → 429 / unstable auth.
2. **Secondary:** No in-flight guard on `signInWithOtp` → double-clicks or Strict Mode could issue parallel sends.
3. **Secondary:** No 429-specific messaging → users hammering Resend after rate limit.
4. **Legacy path:** `/verify-otp` redirect (snapshot `d3ea6f4`) set `pendingOtpEmail` + home; join/login could send once then gate shows OTP screen — not a double send in one mount, but two entry points.

## 3. Files changed

| File | Change |
|------|--------|
| `src/lib/auth/email-otp.js` | **New** — shared send helper, 429 detection, user-facing errors |
| `src/components/auth/AuthGate.js` | Send/verify in-flight refs, button disable, no verify retry loop, pending-email UI copy, centralized send |
| `src/app/verify-otp/page.js` | Same guards for resend + auto-verify |
| `src/app/join/page.js` | In-flight send guard + shared helper |
| `src/app/login/page.js` | In-flight send guard + shared helper |
| `src/context/AuthContext.js` | Dedup `SIGNED_IN`, ignore `TOKEN_REFRESHED` / `INITIAL_SESSION` for OTP-unrelated churn |

**Not touched:** playback, `AudioContext`, Stripe, middleware routes, `page.js` UI.

## 4. Confirmation checklist

- [x] `npm run build` passes
- [x] Grep: no `signInWithOtp` / `sendEmailOtp` inside `useEffect` in `src/`
- [x] OTP **send** only from explicit submit / Resend click handlers
- [x] Auth gate still mounts at root via `AppAuthRoot` when unauthenticated
- [x] Failed verify no longer auto-retries until user edits code or taps Verify / Resend
- [x] 429 shows “wait a minute” message; no automatic retry on rate limit
- [ ] Manual: open app → gate only → Send Code once → receive email → enter code → app loads
- [ ] Manual: wrong 8-digit code → single error, no request storm in network tab

## Verification commands

```bash
npm run build
rg 'useEffect[\s\S]{0,400}(signInWithOtp|sendEmailOtp|sendOtpToEmail)' src/
```

Expected: no matches.

## Deploy

- **Commit:** `fe3fa3b8cfa6bc2919f4f28a955766aa67221d9a`
- **Pushed:** `origin/main`
- **Production:** https://www.2mrrw.com (Vercel deployment `dpl_FsQLpXGzpTnSaQ2eSSRJ8Da4xWbR`)
