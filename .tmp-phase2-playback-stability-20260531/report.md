# Phase 2 — Playback Stability & State Churn Reduction

**Date:** 2026-05-31  
**Audit source:** `.tmp-playback-stability-churn-audit-20260531/`  
**Scope:** Targeted stability fixes only; Phase 1 playback/queue/entitlement architecture unchanged.

---

## 1. Executive summary

Phase 2 reduces global `AuthContext` re-render churn and duplicate network refresh storms after commerce and OTP flows, without changing entitlement source-of-truth or playback resolution logic. Commerce polling on `/success` and `/subscribe` is capped at three attempts with backoff and early exit when entitlements stabilize. OTP verification no longer triple-refreshes account state. Session recovery skips `setQueue` when the fan already has an active queue or playback. `entitlements:updated` is deduplicated within a 400ms window. Auth state updates are guarded with shallow equality. Dev-only `[state-churn]` logging is available behind `NODE_ENV=development` or `NEXT_PUBLIC_STATE_CHURN_LOG`.

**Build:** PASS  
**test:playback-resolver-fallback:** PASS (21/21)  
**test:foundation:** FAIL (2 pre-existing HEAD / recovery-anchor drift — not introduced by Phase 2)

---

## 2. Fix #1 — Commerce refresh storm

### `/success` (`src/app/success/page.js`)

| Metric | Before | After |
|--------|--------|-------|
| `refreshAccountState` max per visit | 8 (1 + 7× poll) | 3 |
| `refreshLibrary` max per visit | 8 | 3 |
| Poll interval | Fixed 2s × 7 | Backoff 1s / 2s / 4s between attempts |
| Early exit | Pending slugs only | Pending slugs **or** unchanged `ownedSlugs` between polls |
| `entitlements:updated` | 1× on first batch | 1× on first attempt via `notifyEntitlementsUpdated` |

### `/subscribe` (`src/app/subscribe/page.js`)

| Metric | Before | After |
|--------|--------|-------|
| `refreshAccountState` per `?subscribed=1` | 5 @ 2.5s interval | 3 @ 0 / +2.5s / +2.5s |
| `refreshAccountState` per modal success | 5 @ 2.5s | 3 (shared `pollSubscriptionAccountState`) |
| Stop condition | Attempt count only | `isSubscriber` or `isLifetimeOwner` from fresh API payload |

**Behavior preserved:** Entitlements still flow from webhook → Supabase → `/api/account/state`; UI unlocks when subscriber flags appear in API response.

---

## 3. Fix #2 — Duplicate OTP refresh

**Chain (before):** `applySessionUser` → `refreshAccountState` (inside AuthContext) → explicit `refreshAccountState` in `verify-otp` / `AuthGate` → `AppAuthRoot.handleVerified` → third `refreshAccountState`.

**Chain (after):** `applySessionUser` only (single `/api/account/state` fetch).

| File | Change |
|------|--------|
| `src/app/verify-otp/page.js` | Removed post-`applySessionUser` `refreshAccountState` |
| `src/components/auth/AuthGate.js` | Same |
| `src/components/auth/AppAuthRoot.js` | Removed `onVerified` refresh callback; gate uses default (no extra refresh) |

**Reduction:** Up to **2 fewer** `refreshAccountState` calls per OTP success on home (was 3, now 1).

---

## 4. Fix #3 — Recovery queue protection

**File:** `src/components/system/AudioPhase10Bridge.js`

On `2mrrw:playback-recovery`, handler now reads live `queueRef` / `hasStartedRef` and **skips** `setQueue` when:

- `hasStarted === true`, or  
- `queue.length > 0`

Restores queue only for abandoned sessions (empty queue, not started). Skips and restores are logged via `logStateChurn('recovery-setQueue', ...)`.

`useSessionRecovery` unchanged (still hydrates and dispatches event); gating is at apply time only.

---

## 5. Fix #4 — Entitlement event dedup

**Module:** `src/lib/diagnostics/state-churn-log.js` — `notifyEntitlementsUpdated({ source, reason })`

- Dedup window: **400ms** (duplicate dispatches logged as `skipped: true`)
- Dispatches carry `detail: { source, reason, ts }` for listener diagnostics

**Call sites updated:**

| Site | Before | After |
|------|--------|-------|
| `src/app/success/page.js` | Raw `CustomEvent` | `notifyEntitlementsUpdated` on first poll attempt |
| `src/app/page.js` `handleCheckoutSuccess` | Raw `CustomEvent` | `notifyEntitlementsUpdated` |

**Listener:** `AudioContext` `onEntitlementsUpdated` unchanged in behavior; reads `event.detail` for logging only. Preview → full upgrade path preserved.

---

## 6. Fix #5 — AuthContext churn guards

**File:** `src/context/AuthContext.js`  
**Helpers:** `src/lib/auth/state-equality.js`

- `applyAccountPayload`: skip `setLibrary`, `setOwnedSlugs`, `setAccountState` when shallow-equal to previous
- `refreshLibrary`: same guards on library / slugs / account slice
- `setIsAdmin`: skip when boolean unchanged
- In-flight fetch coalescing unchanged (`accountStateFetchingRef`)

**No API architecture change** — optional `meta` on `refreshAccountState(meta)` / `refreshLibrary(meta)` for diagnostics only.

---

## 7. Fix #6 — Instrumentation

**Module:** `src/lib/diagnostics/state-churn-log.js`

| Control | Value |
|---------|--------|
| Default on | `NODE_ENV === 'development'` |
| Force on | `NEXT_PUBLIC_STATE_CHURN_LOG=1` |
| Force off | `NEXT_PUBLIC_STATE_CHURN_LOG=0` |

**Logged kinds:** `refreshAccountState`, `refreshLibrary`, `entitlements:updated`, `recovery-setQueue`, `upgradeToFullStream`

**Fields:** `kind`, `source`, `reason`, `ts`, plus event-specific extras (`skipped`, `queueLength`, `slug`, etc.)

**Wired in:** `AuthContext`, `AudioPhase10Bridge`, `AudioContext` (listener + `upgradeToFullStream` entry)

---

## 8. Validation & files changed

### Validation results

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** |
| `npm run test:playback-resolver-fallback` | **PASS** (21 scenarios) |
| `npm run test:foundation` | **FAIL** — pre-existing: `FRONTEND_FOUNDATION_BASELINE.md` HEAD mismatch; operational anchor `bac9eb71` ≠ HEAD `e1808137` |

### Files created (Phase 2)

- `src/lib/diagnostics/state-churn-log.js`
- `src/lib/auth/state-equality.js`

### Files modified (Phase 2)

- `src/context/AuthContext.js`
- `src/context/AudioContext.js` (instrumentation only)
- `src/app/success/page.js`
- `src/app/subscribe/page.js`
- `src/app/page.js` (checkout entitlement notify + refresh meta)
- `src/app/verify-otp/page.js`
- `src/components/auth/AuthGate.js`
- `src/components/auth/AppAuthRoot.js`
- `src/components/system/AudioPhase10Bridge.js`

### Not modified (per constraints)

Playback resolver, queue engine, entitlement purchase paths, `useSessionRecovery` dispatch, cinematic `page.js` layout, collector/subscription backend.

### Refresh count summary (worst case per user journey)

| Journey | refreshAccountState before | after |
|---------|---------------------------|-------|
| Success page visit | 8 | 3 |
| Subscribe `?subscribed=1` | 5 | 3 |
| Subscribe modal success | 5 | 3 |
| OTP verify (home gate) | 3 | 1 |

### Manual verification checklist

- [ ] Guest preview play → inline checkout on home → preview upgrades to full without gap
- [ ] Stripe redirect `/success` → collection unlocks within 3 polls
- [ ] `/subscribe?subscribed=1` → Inner Circle UI unlocks
- [ ] OTP sign-in on home → single entitlement fetch, no login flash
- [ ] Play track → reload tab with stale recovery snapshot → active queue not replaced
- [ ] Dev console: `[state-churn]` lines on refresh / entitlement / recovery

---

## Deliverable artifact

Zip: `/Users/recharge/Downloads/phase2-playback-stability-20260531.zip`  
Contents: this report + `manifest.txt`
