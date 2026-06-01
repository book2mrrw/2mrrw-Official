# Live Production Auth Stability Audit

**Project:** artist-platform (2MRRW)  
**Date:** 2026-05-30  
**Scope:** Client auth layer — `authService.js`, `AuthContext.js`, login/join/verify-otp pages, `AuthGate.js`, OTP paths  
**Constraints:** Minimal bug fixes only; no architecture/UI changes

---

## SAFE FIXES APPLIED (2)

### Fix 1 — AuthContext Strict Mode listener drop

**File:** `src/context/AuthContext.js`  
**Lines:** ~220–282 (session bootstrap `useEffect`)

**Problem:** The effect used `sessionBootstrappedRef` as an early return for the *entire* effect body. React 18 Strict Mode (enabled by default in Next.js) runs effect cleanup then re-runs the effect. After cleanup `unsubscribe()` removed the auth listener, but the ref guard prevented re-subscription on remount — leaving the app without `subscribeAuthState` handling for `SIGNED_OUT`, `SIGNED_IN`, etc.

**Fix:** Split bootstrap (once per provider lifetime via ref) from subscription (always register on mount, always unsubscribe on cleanup). On Strict Mode remount when bootstrap already ran, set `loading` to `false` without re-fetching account state.

**Why minimal:** No new modules, no API changes, no UI changes. Preserves module-level `bootstrapSession` singleton.

---

### Fix 2 — Login resend OTP `shouldCreateUser` mismatch

**File:** `src/app/login/page.js`  
**Lines:** ~105–109

**Problem:** Login sends OTP with `shouldCreateUser: false`, but navigation to `/verify-otp` omitted `createUser=0`. The verify page defaults `shouldCreateUser = searchParams.get("createUser") !== "0"` → **true**. Resend on verify-otp after sign-in could call `signInWithOtp` with `shouldCreateUser: true`, diverging from login intent and potentially causing Supabase signup-path behavior for existing users.

**Fix:** Append `createUser: "0"` to verify-otp URL params from login page.

**Why minimal:** One query param; no flow redesign.

---

## RECOMMENDED IMPROVEMENTS (NOT APPLIED) — 8

1. **Align resend UI cooldown with authService (60s)** — `verify-otp/page.js` and `AuthGate.js` use 30s `resendIn` countdown while `authService.sendEmailOtp` enforces 60s cooldown. Users see "Resend code" enabled at 30s but get rate-limit error until 60s. Advisory: sync UI timer to `getOtpCooldownRemainingMs(email)` or raise UI timer to 60s.

2. **Explicit `createUser=1` on join → verify-otp** — Join flow works today (default true), but explicit param would make intent self-documenting and resilient to default changes.

3. **Duplicate `refreshAccountState` after OTP verify** — Both `verify-otp/page.js` and `AuthGate.js` call `applySessionUser` (which already refreshes account state) then `refreshAccountState()` again. Harmless but adds redundant network. Consolidate in advisory refactor only.

4. **Custom `restoreSessionFromStorage` vs Supabase SSR client** — `authService.bootstrapSession` manually reads `SUPABASE_AUTH_STORAGE_KEY` and calls `setSession`. Supabase browser client already persists via same key. Manual restore is intentional for Safari ITP but increases cross-tab race surface. Monitor; consider relying solely on Supabase's built-in storage sync if ITP path is no longer needed.

5. **`DEVICE_SESSION_KEY` UX marker** — Correctly documented as non-auth; could confuse future contributors. Add inline comment at call sites or move to dedicated `device-trust.js` module (architecture change — not applied).

6. **`AuthGate.resetForm` incomplete ref reset** — Does not reset `otpRequestIdRef` or `completeProfileFetchedRef`. Low risk because form close resets mode; advisory cleanup only.

7. **Server-side `supabase.auth.getUser()` in API routes** — Separate from client audit; ensure cookie/session propagation matches `SUPABASE_AUTH_STORAGE_KEY` on middleware. No client duplicate found.

8. **Centralize OTP verify + complete-profile post-flow** — `verify-otp/page.js` and `AuthGate.js` duplicate ~40 lines of verify/complete-profile logic. Extraction would reduce drift risk but is a refactor (not applied).

---

## FINAL VERIFICATION

| Check | Status | Notes |
|-------|--------|-------|
| Duplicate auth listeners | **PASS** | Single `onAuthStateChange` in `authService.js` (module singleton). Consumers use `subscribeAuthState` Set. Only `AuthContext` subscribes. |
| Session race conditions | **PASS** (after fix 1) | `bootstrapPromise` + `bootstrapComplete` guard concurrent bootstrap. `accountStateFetchingRef` dedupes account fetches. |
| Cross-tab session conflicts | **PASS** (monitor) | Supabase client: `persistSession`, shared `storageKey`, `autoRefreshToken`. Custom localStorage restore is supplementary. |
| OTP trigger safety | **PASS** (after fix 2) | Single-flight Map, requestId dedup, 60s cooldown (memory + localStorage), in-flight refs on all send surfaces. |
| Single source of truth | **PASS** | All client `supabase.auth.*` calls confined to `authService.js`. Entitlements from `/api/account/state`, not client overrides. |
| Strict Mode double init | **PASS** (after fix 1) | Module bootstrap survives remount; AuthContext now re-subscribes on remount. |

### Build

```
npm run build — PASS (exit 0, Next.js 16.2.4)
```

### Architectural changes

**None.** Two targeted line-level fixes in existing files only.

---

## Summary counts

| Metric | Count |
|--------|-------|
| Safe fixes applied | **2** |
| Advisory recommendations | **8** |
| Build | **PASS** |
| Zip | `/Users/recharge/Downloads/auth-stability-audit-20260530.zip` |
