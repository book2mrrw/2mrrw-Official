# Lowest-Risk Implementation Plan

Preserves all tiers/flows (guest, subscriber, Vault, collector, library purchase). Phased; each phase independently shippable.

## Phase 0 — Baseline (no code)

- Capture trace: play track on home → complete test purchase → note dropouts  
- Run `npm run test:foundation` before/after each phase  

## Phase 1 — Dedupe refreshes only (~1 day)

**Files:** `AuthContext.js`, `verify-otp/page.js`, `AuthGate.js`, `AppAuthRoot.js`

1. Remove explicit `refreshAccountState()` where `applySessionUser` already ran (F2).  
2. Add `refreshAccountAndLibrary` helper; switch **one** callsite (e.g. `useMusicLibrary`) to validate.  

**Risk:** Low — fewer network calls, same data path.  
**Rollback:** Revert 3 OTP files.  

## Phase 2 — Tame polling (~1 day)

**Files:** `success/page.js`, `subscribe/page.js`

1. Cap success loop at 3 attempts, backoff 1s / 2s / 4s (F1).  
2. Subscribe interval: 3 attempts, stop when `isSubscriber` true (F1).  
3. Do **not** remove `entitlements:updated` on success initial batch.  

**Risk:** Low — slower UI unlock if webhook delayed (show “still confirming…” copy).  

## Phase 3 — Entitlement event parity (~0.5 day)

**Files:** New `lib/entitlements/notify-updated.js`, `CollectorCardModal`, `gift/[token]`, `page.js` checkout helper

1. Central `notifyEntitlementsUpdatedIfNeeded(prevSlugs, nextSlugs)` (F4).  
2. Call after confirmed refresh when slugs grew.  

**Risk:** Low — only adds preview→full upgrade path; no new entitlements.  

## Phase 4 — Recovery guard (~0.5 day)

**Files:** `AudioPhase10Bridge.js`

1. If `hasStarted` or `queue.length > 0`, skip `setQueue` from recovery event (F7).  
2. Log diagnostic once when skipped.  

**Risk:** Medium-low — users with stale tab mid-play won’t get old queue restored (desired).  

## Phase 5 — page.js churn (optional, larger)

**Files:** `page.js`, leaf components

1. Single `handleLibraryChange` callback (F6).  
2. Move live countdown to child (F9).  

**Risk:** Medium — touch many props; test mobile home + playback.  

## Phase 6 — Context split (defer)

Only if Phase 1–5 insufficient. Split entitlements context (F5).  

## Verification checklist (each phase)

- [ ] Guest browse + preview play  
- [ ] Subscriber full stream  
- [ ] Inline checkout on home + `entitlements:updated` upgrade  
- [ ] `/success` redirect path  
- [ ] Subscribe `?subscribed=1`  
- [ ] Collector card purchase  
- [ ] iOS Safari: play → lock → unlock → tap resume  
- [ ] Background 2+ min with stream URL near expiry  

## Success metrics

- `refreshAccountState` calls per purchase flow ≤ 3  
- No audible gap during entitlement poll on home  
- Recovery skip rate logged when active queue present
