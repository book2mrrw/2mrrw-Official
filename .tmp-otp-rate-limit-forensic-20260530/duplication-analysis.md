# OTP Duplication Analysis

**HEAD:** `04d326f` (includes `43d37ff` email-intent fix)  
**Question:** Can a single user action produce multiple `signInWithOtp` network requests?

---

## Verdict: **NO** for a single Send Code / Resend click on current HEAD

Duplication from frontend double-fire on one intentional action is **prevented** by layered guards in `authService.sendEmailOtp` and each UI surface.

---

## authService.js guard stack (module-level, survives Strict Mode remount)

| Guard | Key | Effect on duplicate |
|-------|-----|---------------------|
| Request idempotency | `${normalizedEmail}:${requestId}` in `otpSeenRequestIds` | Second call with same email+requestId → `{ deduplicated: true }`, **no network** |
| Client cooldown | `otpCooldownUntil` Map + `localStorage` key `2mrrw-otp-cooldown:{email}` | Second call within 60s → `{ error: { status: 429 }, cooldownMs }`, **no network** |
| Single-flight | `otpFlights` Map keyed by email | Concurrent calls for same email share one in-flight promise → **one network** |
| Cooldown timing | `applyCooldown` runs **before** `signInWithOtp` | Even failed Supabase responses consume 60s client lock |

---

## Per-surface duplication risk

### E1 — `login/page.js` submit

| Scenario | Multiple fires? | Why |
|----------|-----------------|-----|
| Double-click submit | **No** | `loading \|\| otpSendInFlightRef` early return; same `submitRequestIdRef` until `finally` → authService dedupe |
| Enter + click | **No** | Single form submit event |
| Strict Mode remount | **No** | Submit is event handler, not effect |
| Re-render during send | **No** | Refs persist; in-flight ref blocks re-entry |
| Email edited mid-flight | **Reset** | `handleEmailChange` calls `resetOtpEmailIntent`, clears refs — **intentional** new send allowed for new email |

**requestId lifecycle:** Created once per submit attempt; cleared in `finally` (L125). Cleared on email change (L69).

### E2 — `join/page.js` submit

Identical guard pattern to E1.

### E3 — `AuthGate.js` sendOtpToEmail

| Scenario | Multiple fires? | Why |
|----------|-----------------|-----|
| Double-click Send Code | **No** | `otpSendInFlightRef` + parent `loading \|\| otpSending` |
| Signup then immediate signin switch | **No** unless user submits both forms | Separate user actions |
| Modal close mid-send | **Partial reset** | `resetForm` clears `otpRequestIdRef` (post-fix L125); in-flight Supabase call may still complete |
| Resend before 30s UI timer | **No** | `resendIn > 0` blocks handler |
| Resend at 30s (UI enabled) | **No network** | authService 60s cooldown returns client 429 — see flow-simulation |

**requestId lifecycle:** Created in `sendOtpToEmail`; cleared in `finally` (L183). Email change resets via `handleEmailChange` (L148).

### E4 — `verify-otp/page.js` resendOtp

| Scenario | Multiple fires? | Why |
|----------|-----------------|-----|
| Resend double-click | **No** | `otpSendInFlightRef` + `otpSending` |
| Resend at 30s | **No Supabase call** | Client cooldown still ~30s remaining |
| Resend after 60s | **One request** | Expected legitimate resend |

**Note:** Initial OTP for verify-otp page is sent by E1/E2 **before** navigation; verify-otp does **not** send on mount.

---

## Cross-email state leakage (pre vs post 43d37ff)

| Issue | Pre-fix | Post-fix (`43d37ff`) |
|-------|---------|------------------------|
| Global `requestId` dedupe (not scoped to email) | Could **block** send for email B (silent dedupe) — opposite of "too many" | Fixed: `${email}:${requestId}` |
| In-flight ref not cleared on email edit | Could block or reuse stale context | Fixed: `resetOtpEmailIntent` + ref clear in login/join/AuthGate |
| Cooldown keyed per email | Already correct | Unchanged |

**Duplication finding for email-change flow:** Post-fix, changing email and resubmitting produces **one** network call for the new email, not a duplicate for the old one.

---

## Strict Mode analysis

- Next.js default: React Strict Mode **enabled in development** (`next.config.mjs` has no override).
- OTP **send** handlers are **not** in `useEffect` → Strict Mode double-mount does **not** double-send.
- Module-level maps (`otpFlights`, `otpCooldownUntil`, `otpSeenRequestIds`) survive component remounts → dedupe/cooldown persist correctly across remounts.

---

## UI timer vs service cooldown mismatch (NOT duplication, but confuses diagnosis)

| Layer | Resend lock duration |
|-------|---------------------|
| `authService.sendEmailOtp` | **60s** (`OTP_COOLDOWN_MS`) |
| `verify-otp/page.js` `resendIn` | **30s** initial countdown |
| `AuthGate.js` `resendIn` | **30s** initial countdown |

At T+30s the UI enables "Resend code" but authService rejects with the **same user message** as Supabase rate limit (`formatOtpSendError({ status: 429 })`) **without any network request**.

This is **not** frontend duplication (A). It is a **client-side rejection** that mimics (B).

---

## Scenarios that DO produce multiple legitimate network requests

These are **separate user actions**, not accidental duplication:

1. Send on login → navigate to verify-otp → resend after 60s (2 requests, expected)
2. Send via AuthGate → later send via `/login` for same email within 60s (2nd blocked by cooldown)
3. Send for email A → change to email B → send (2 requests to different addresses, expected)
4. Prior session attempts + new send within Supabase server window (historical accumulation)

---

## Duplication summary

| Finding | Yes/No |
|---------|--------|
| Multiple `signInWithOtp` from one Send Code click | **No** |
| Auto-send on mount / route change | **No** |
| Strict Mode double-send | **No** |
| Re-render re-trigger send | **No** |
| Resend at 30s causes second Supabase call | **No** (client cooldown blocks) |
| Resend after 60s causes second Supabase call | **Yes** (by design) |
| Pre-fix email-change could cause wrong dedupe/block | **Yes** (fixed in 43d37ff) |
