# OTP Event Flow Simulation

**Scenario:** enter email → send code → change email → retry send  
**Code base:** HEAD `04d326f` + `43d37ff` email-intent fix

---

## Simulation 1: Happy path — login page

```
T0  User on /login, enters user@example.com
T1  User clicks "Send Code" once
    → submitRequestIdRef = UUID-A
    → otpSendInFlightRef = true, loading = true
    → sendEmailOtp({ email, shouldCreateUser: false, requestId: UUID-A })
        → otpSeenRequestIds["user@example.com:UUID-A"] = now
        → applyCooldown("user@example.com") → until T1+60s
        → signInWithOtp × 1  ✅ NETWORK REQUEST #1
    → router.push("/verify-otp?email=...&createUser=0")
    → finally: submitRequestIdRef = null, otpSendInFlightRef = false

T2  verify-otp mounts
    → NO sendEmailOtp call (email from URL only)
    → resendIn countdown starts at 30

T3  T1+30s — UI enables "Resend code"
    User taps Resend
    → resendRequestIdRef = UUID-B
    → sendEmailOtp({ email, shouldCreateUser: false, requestId: UUID-B })
        → getOtpCooldownRemainingMs ≈ 30_000
        → returns { error: { status: 429 }, cooldownMs: 30000 }  ❌ NO NETWORK
    → User sees: "Too many code requests. Wait a minute, then tap Send code again."

T4  T1+60s — User taps Resend again
    → sendEmailOtp → cooldown clear
    → signInWithOtp × 1  ✅ NETWORK REQUEST #2 (legitimate resend)
```

**Request count (T1 single click):** **1** Supabase call  
**"Too many" at T3:** Client cooldown, **not** Supabase, **not** duplicate frontend send

---

## Simulation 2: Double-click Send Code (login)

```
T0  User double-clicks "Send Code" rapidly
Click 1:
    → submitRequestIdRef = UUID-A
    → sendEmailOtp starts, rememberRequestId, applyCooldown, flight registered
Click 2 (before finally):
    → loading || otpSendInFlightRef → early return at L88  ❌ blocked at UI
OR if race passes UI:
    → same submitRequestIdRef UUID-A
    → authService: otpSeenRequestIds.has("email:UUID-A") → deduplicated: true  ❌ no network
```

**Network requests:** **1**

---

## Simulation 3: Email change mid-flow (post 43d37ff)

```
T0  User enters alice@example.com, clicks Send Code
    → NETWORK #1 for alice@example.com
    → alice cooldown until T0+60s
    → Error shown OR navigate to verify-otp (assume error path, user stays on login)

T1  User edits email field: alice → bob@example.com
    → handleEmailChange:
        resetOtpEmailIntent("alice@example.com", { requestId: UUID-A })
          → otpFlights.delete("alice@...")
          → otpSeenRequestIds.delete("alice@...:UUID-A")
        submitRequestIdRef = null
        otpSendInFlightRef = false

T2  User clicks Send Code for bob@example.com
    → submitRequestIdRef = UUID-B (new)
    → sendEmailOtp bob:
        → alice cooldown still active (preserved) — irrelevant to bob
        → bob has no cooldown
        → signInWithOtp × 1  ✅ NETWORK for bob only
```

**Request count:** 2 total (1 per email), **not** duplicate for single action  
**requestId dedupe scoping:** UUID-A scoped to alice; bob gets fresh UUID-B  
**Cooldown on second email:** bob unaffected by alice's 60s lock

---

## Simulation 4: AuthGate root overlay signup

```
T0  Unauthenticated user lands on /
    → AppAuthRoot mounts AuthGate (variant=root, open=true)
    → NO OTP send on mount

T1  User fills signup form, clicks "Send Verification Code"
    → checkEmailExists API call (NOT signInWithOtp)
    → sendOtpToEmail(email, !exists)
        → otpRequestIdRef = UUID-C
        → signInWithOtp × 1  ✅ NETWORK #1
        → setMode("otp"), resendIn = 30

T2  User taps Resend at 30s
    → sendOtpToEmail (new UUID-D after finally cleared UUID-C)
    → client cooldown blocks  ❌ NO NETWORK, same error message
```

---

## Simulation 5: Join → verify-otp resend (createUser intent)

```
T0  /join submit
    → sendEmailOtp({ shouldCreateUser: true })  ✅ NETWORK #1
    → router.push("/verify-otp?email=...&next=...")  (no createUser param → defaults true)

T1  Resend after 60s on verify-otp
    → shouldCreateUser = searchParams.get("createUser") !== "0" → true
    → sendEmailOtp({ shouldCreateUser: true })  ✅ NETWORK #2
```

Login path (fixed): passes `createUser=0` so resend uses `shouldCreateUser: false`.

---

## Simulation 6: Supabase server rate limit (true B)

```
T0  User (or prior buggy session) already triggered 4+ OTP sends in Supabase window
T1  Single correct sendEmailOtp call
    → passes all client guards (cooldown expired, new requestId)
    → signInWithOtp × 1  ✅ exactly ONE request leaves browser
    → Supabase returns 429 / "too many requests"
    → formatOtpSendError → "Too many code requests..."
    → applyCooldown already ran at T1 → client also locks 60s
```

**Diagnosis:** Single request rejected by Supabase (answer **B**). Network tab shows **one** outbound OTP request with 429 response.

---

## Distinguishing client vs Supabase "too many"

| Observation | Client cooldown (60s) | Supabase 429 |
|-------------|----------------------|--------------|
| Network tab at error time | **No** new `signInWithOtp` request | **One** request with 429 |
| Timing after first send | 0–60s | Any (including first send if server history) |
| Error object source | `sendEmailOtp` returns before `signInWithOtp` | Supabase response on `signInWithOtp` |
| UI resend enabled | Often at 30s (mismatch) | N/A |

---

## Flow simulation summary

| Step | Expected network OTP sends |
|------|---------------------------|
| Single Send Code click | 1 |
| Double-click same submit | 1 |
| verify-otp page load after login/join send | 0 |
| Resend at 30s | 0 (client block) |
| Resend at 60s+ | 1 |
| Change email + retry send | 1 for new email |
| Email A send + email B send | 1 each (2 total) |
