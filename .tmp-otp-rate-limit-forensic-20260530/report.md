# OTP Rate-Limit Forensic Trace

**Project:** artist-platform (2MRRW)  
**Date:** 2026-05-31  
**Mode:** Read-only diagnostic — **no code changes**  
**HEAD analyzed:** `04d326fc75080126070d8f8de9944ab95acf9027`  
**Includes fix:** `43d37ff` — OTP email intent isolation across email changes  
**Working tree:** Clean vs HEAD for auth OTP files (no uncommitted drift)

---

## Executive summary

| Question | Answer |
|----------|--------|
| **Root cause verdict** | **MIXED** |
| **Entry point count (UI send paths)** | **6** handler paths across **4** files |
| **Canonical send count** | **1** (`authService.sendEmailOtp`) |
| **`signInWithOtp` bypass count** | **0** |
| **Auto-send on mount/effect** | **0** |

**Primary finding:** On current HEAD, a single "Send Code" click does **not** produce multiple frontend OTP requests (**not A**). The user-visible message *"Too many code requests. Wait a minute, then tap Send code again."* is emitted in **two** distinct cases: (1) **client-side 60s cooldown** in `authService` — often triggered when the user taps Resend after the **30s** UI countdown — with **zero** network calls; and (2) **Supabase rejecting a single outbound request** (**B**) when server-side OTP limits are already exhausted from prior attempts.

---

## A. OTP Entry Point Map

See [`entry-point-map.md`](./entry-point-map.md).

### Canonical choke point

```324:377:src/auth/authService.js
export async function sendEmailOtp({ email, shouldCreateUser = false, requestId } = {}) {
  // ... idempotency, cooldown, single-flight ...
  const result = await supabase.auth.signInWithOtp({
    email: normalized,
    options: { shouldCreateUser },
  });
  // ...
}
```

### All UI callers (each invokes `sendEmailOtp` only)

| ID | File | Handler | Trigger |
|----|------|---------|---------|
| E1 | `src/app/login/page.js` | `submit` | Form submit |
| E2 | `src/app/join/page.js` | `submit` | Form submit |
| E3a | `src/components/auth/AuthGate.js` | `submitSignup` → `sendOtpToEmail` | Form submit |
| E3b | `src/components/auth/AuthGate.js` | `submitSignin` → `sendOtpToEmail` | Form submit |
| E3c | `src/components/auth/AuthGate.js` | `resendOtp` → `sendOtpToEmail` | Button click |
| E4 | `src/app/verify-otp/page.js` | `resendOtp` | Button click |

**No** `sendEmailOtp` inside any `useEffect`. **No** writers for `pendingOtpEmail` in current `src/` (AuthGate only reads legacy key for UI restore).

---

## B. Duplication Findings

See [`duplication-analysis.md`](./duplication-analysis.md).

| Finding | Result |
|---------|--------|
| Multiple `signInWithOtp` from one Send Code click | **No** |
| Strict Mode double-send | **No** (send is event-driven; module guards survive remount) |
| Re-render re-trigger send | **No** |
| Route change auto-send | **No** (verify-otp mount does not send) |
| Resend at 30s causes second Supabase call | **No** — client 60s cooldown blocks |
| Email-change cross-contamination (pre-43d37ff) | **Yes** (fixed) — global requestId could block wrong email |

### Guard layers (defense in depth)

1. UI: `loading` / `otpSendInFlightRef` / `otpSending`
2. UI: per-submit `requestId` refs
3. Service: `${email}:${requestId}` idempotency map
4. Service: 60s cooldown (memory + `localStorage` `2mrrw-otp-cooldown:{email}`)
5. Service: per-email single-flight promise map

---

## C. Likely Root Cause

### Verdict: **MIXED** (not pure A, not pure B in typical UX)

#### Component 1 — Client cooldown masquerading as rate limit (most common on HEAD)

- `authService` enforces **60s** cooldown and returns `status: 429` with message *"Too many code requests..."* **before** calling Supabase.
- `verify-otp/page.js` and `AuthGate.js` enable Resend after **30s** (`resendIn` initial value).
- User taps Resend at 30s → error shown → **no network request** in DevTools.
- This is **neither** multiple frontend sends **nor** Supabase rejection; it is intentional client throttling with Supabase-identical copy.

#### Component 2 — True Supabase rate limit on single request (B)

- When client cooldown has expired and exactly **one** `signInWithOtp` is sent, Supabase may still return 429 if the email/IP hit Supabase's own OTP window from **prior** sends (earlier session, different surface, or pre-guard code).
- Network tab: **one** outbound auth OTP request → 429 response.

#### Component 3 — Historical frontend duplication (A) — mitigated on HEAD

- Prior audits (`.tmp-otp-fix-20260528`) documented missing in-flight guards and verify retry loops.
- Current HEAD centralizes send in `authService` with single-flight + idempotency.
- **A is unlikely for a single click today** but prior duplicate sends may have **seeded** Supabase server limits (making present attempts look like B).

#### Ruled out on HEAD

- Auto-send on mount / `useEffect`
- Direct `signInWithOtp` bypass outside `authService`
- verify-otp page sending OTP on navigation (initial send is always from E1/E2/E3 before route change)

---

## D. Proof

### Proof 1 — Single network choke point

```
rg 'signInWithOtp' src/
→ src/auth/authService.js:361 only
```

### Proof 2 — No effect-driven sends

```
rg -U 'useEffect[\s\S]{0,500}(sendEmailOtp|sendOtpToEmail|signInWithOtp)' src/
→ no matches
```

### Proof 3 — Error message has two sources, one string

```156:167:src/auth/authService.js
export function isOtpRateLimitError(err) {
  const status = err?.status ?? err?.code;
  if (status === 429 || status === "429") return true;
  const msg = String(err?.message || "");
  return /rate limit|too many requests|too many code|429/i.test(msg);
}

export function formatOtpSendError(err) {
  if (isOtpRateLimitError(err)) {
    return "Too many code requests. Wait a minute, then tap Send code again.";
  }
  // ...
}
```

Client cooldown path synthesizes `{ status: 429 }` at L337–346 **without** calling Supabase.

### Proof 4 — 30s UI vs 60s service mismatch

| Location | Timer |
|----------|-------|
| `authService.js` `OTP_COOLDOWN_MS` | 60000 |
| `verify-otp/page.js` L26 `resendIn` initial | 30 |
| `AuthGate.js` L92 `resendIn` initial | 30 |

### Proof 5 — Email intent fix (43d37ff) scoped dedupe

Before: `otpSeenRequestIds` keyed by `requestId` alone → cross-email silent dedupe/block.  
After: `${email}:${requestId}` + `resetOtpEmailIntent` on email field change in login/join/AuthGate.

### Proof 6 — Server vs client discrimination procedure

1. Open DevTools → Network, filter auth/otp.
2. Single Send Code click → expect **exactly 1** request.
3. If error shown with **0** new network rows → **client cooldown**.
4. If error shown with **1** request returning 429 → **Supabase (B)**.

---

## E. No Fixes Yet

Per scope: **no code changes applied in this forensic run.**

Advisory items for a future fix pass (documented only):

1. Align UI `resendIn` (30s) with `OTP_COOLDOWN_MS` (60s) or drive countdown from `getOtpCooldownRemainingMs(email)`.
2. Differentiate client-cooldown vs Supabase 429 in user messaging (optional).
3. Add explicit `createUser=1` on join → verify-otp URL for intent clarity (audit recommendation, not duplication-related).

---

## Related artifacts

| File | Contents |
|------|----------|
| `entry-point-map.md` | Full entry point table + lifecycle audit |
| `duplication-analysis.md` | Per-path frequency analysis |
| `flow-simulation.md` | Step-by-step request counting scenarios |
| `manifest.txt` | File listing + commands run |

---

## Commands executed

```bash
git rev-parse HEAD
git log -3 --oneline
git diff HEAD -- src/auth/authService.js src/app/login/page.js src/app/join/page.js src/components/auth/AuthGate.js
rg 'signInWithOtp|sendEmailOtp' src/
rg 'signInWithOtp' /Users/recharge/artist-platform
rg -U 'useEffect[\s\S]{0,500}(sendEmailOtp|sendOtpToEmail|signInWithOtp)' src/
rg 'pendingOtpEmail|too many|rate.?limit|cooldown|requestId' src/
```
