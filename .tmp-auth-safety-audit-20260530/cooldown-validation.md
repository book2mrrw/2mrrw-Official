# OTP Cooldown System Validation

**Prefix:** `2mrrw-otp-cooldown:{normalizedEmail}`  
**Duration:** `OTP_COOLDOWN_MS` = 60_000 ms  
**Storage format:** Unix expiry timestamp (number as string), not boolean flags

## Implementation summary

| Layer | Mechanism |
|-------|-----------|
| Memory | `otpCooldownUntil` Map — email → expiry timestamp |
| Persistence | localStorage — same expiry timestamp |
| Effective until | `max(memory, storage)` after sanitization |
| Apply | `applyCooldown()` sets `Date.now() + OTP_COOLDOWN_MS` on send attempt |
| Check | `getOtpCooldownRemainingMs()` → `max(0, until - Date.now())` |

## Verification checklist

| # | Requirement | Result |
|---|-------------|--------|
| 1 | Cooldown is time-based (not permanent lock) | **PASS** — 60s window from expiry timestamp |
| 2 | Resets correctly after expiration | **PASS** — `until <= Date.now()` → remaining 0 |
| 3 | localStorage cannot cause infinite lockout | **PASS** (after fix) — `sanitizeCooldownUntil` caps runaway values |
| 4 | Refresh/tab reopen does NOT permanently block OTP | **PASS** — expired keys cleared on read; stale future values rejected |
| 5 | Cooldown respects timestamp logic (not boolean flags) | **PASS** — only numeric expiry timestamps |

## Issue found and fixed

**Before:** A manually edited or corrupted localStorage value (e.g. `9999999999999999`) could block OTP sends until that wall-clock time — effectively permanent lockout.

**After:**

- `sanitizeCooldownUntil()` rejects `until > now + OTP_COOLDOWN_MS + 5s skew`
- Expired or invalid stored keys removed via `localStorage.removeItem` on read
- In-memory map entries pruned when expired

## Edge cases reviewed

| Case | Outcome |
|------|---------|
| Empty / NaN stored value | Treated as 0, no block |
| Expired timestamp | Removed from storage, cooldown 0 |
| Tab close during cooldown | Remaining time still valid until expiry (intended UX) |
| Cooldown applied before network completes | 60s from attempt time (intended anti-storm) |
| Duplicate `requestId` | Deduplicated, does not extend cooldown |
| Supabase 429 from server | Separate from client cooldown; no auto-retry |

## AuthContext interaction

None — cooldown is isolated to `sendEmailOtp` in `authService.js`. No UI changes.
