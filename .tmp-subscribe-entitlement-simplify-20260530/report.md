# Subscribe page entitlement simplification

**Date:** 2026-05-30  
**Scope:** `src/app/subscribe/page.js` only (no OTP/auth service, no layout/styling/text changes)

## Files changed

| File | Change |
|------|--------|
| `src/app/subscribe/page.js` | Removed auth/guest identity flow; entitlement-only gate; auto Stripe checkout when eligible |

## Auth logic removed

- `currentUser` checks and `!currentUser` conditional UI (Attach Your Membership form: name, email, phone)
- `enterGuest()` guest signup before checkout (`ensureSubscriptionIdentity`)
- Identity state: `identityLoading`, `identityError`, `identityName`, `identityEmail`, `identityPhone`
- `authLoading` gating of unlocked experience (replaced with `accountLoading` + entitlement flags only)
- Pre-checkout identity validation (“Enter email and phone…”, location error, guest attach errors)
- Manual-only checkout path that required identity first

## Entitlement logic that remains

Reads **only** from `useAuth()` account payload (not session/auth gates):

| Signal | Source |
|--------|--------|
| `isSubscriber` | `accountState.subscriberActive` OR `membershipHasPremiumAccess(membership)` |
| `isLifetimeOwner` | `accountState.collectorCard` |
| `isEligible` | `!isSubscriber && !isLifetimeOwner` |
| `experienceUnlocked` | Post-checkout `?subscribed=1`, or subscriber/collector after account state loads |
| `showSubscribeButtons` | `isEligible` only |

**Behavior:**

- **Eligible:** On load (after account state ready), POST `/api/memberships/checkout` once and mount Stripe `Elements` modal immediately; Subscribe buttons remain for retry after cancel.
- **Not eligible:** No Stripe fetch/modal; unlocked message shown; Subscribe buttons hidden.
- **Post-payment:** `refreshAccountState` polling unchanged; `?subscribed=1` sync unchanged.

`accountLoading` from AuthContext is used only to defer entitlement evaluation until `/api/account/state` has been applied — not as an authentication check.

## Zero auth checks confirmation

Grep on `src/app/subscribe/page.js` for `currentUser`, `enterGuest`, `authStatus`, `redirect` (auth), `unauthenticated`, `ensureSubscription`, `identity*`: **none** (Stripe `redirect: "if_required"` is payment API only).

No login redirects, session validation, or guest fallback UI remain on the Subscribe page.

## Build

```
npm run build — PASS (exit 0)
```

## Success criteria checklist

- [x] No auth logic, session checks, login/signup, or unauthenticated fallback on Subscribe page
- [x] Entitlement via `subscriberActive` / `membership` / `collectorCard` only
- [x] Eligible users auto-mount Stripe checkout on load
- [x] Subscribers and collector-card owners see existing unlocked state; no Stripe
- [x] Subscribe buttons hidden when not eligible (subscriber or lifetime collector)
- [x] Visual copy, layout, colors, and styling preserved (identity block removed per scope — not a redesign)
- [x] OTP/auth services untouched
- [x] Production build passes

## Optional artifact

Zip (if created): `/Users/recharge/Downloads/subscribe-entitlement-simplify-20260530.zip`
