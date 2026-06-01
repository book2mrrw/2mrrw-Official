# 2-Step Subscription Flow Restore

**Date:** 2026-05-31  
**Scope:** Flow timing only (auto-trigger → click-trigger). No auth, Stripe API route, or UI changes.

## Summary

Restored the intended two-step subscription path:

1. **Homepage** — Subscribe CTA navigates to `/subscribe` only (no Stripe).
2. **Subscribe page** — Stripe membership modal opens only when the user clicks Subscribe.

## Auto-trigger removed

**File:** `src/app/subscribe/page.js`

Removed a `useEffect` that ran when `accountLoading` finished and `isEligible` was true. It called `startSubscription()` (POST `/api/memberships/checkout`) on mount / eligibility change without a user click.

Also removed `checkoutStartedRef`, which only guarded that auto-start path.

**Preserved (not subscription auto-checkout):**

- `useEffect` for `?subscribed=1` return URL — refreshes account state after successful payment; does not open Stripe.
- Homepage `useEffect` for `?checkout=pending` — cart product checkout resume; unrelated to membership.

## Click handler preserved

Subscribe page buttons still call `startSubscription` on click:

- Hero CTA: `onClick={startSubscription}`
- Footer CTA: `onClick={startSubscription}`

Flow: click → POST `/api/memberships/checkout` → `setSubscriptionClientSecret` → Stripe `Elements` modal.

## Homepage navigation verified

**File:** `src/app/page.js` (line ~1939)

```js
onClick={() => { window.location.href = "/subscribe"; }}
```

No `memberships/checkout` or subscription Stripe modal on homepage Subscribe.

**Other `/subscribe` links (navigation only):**

| File | Behavior |
|------|----------|
| `src/components/preview/PreviewEndedCTA.js` | `href="/subscribe"` |
| `src/components/preview/ImmersivePreviewModal.js` | `Link href="/subscribe"` |
| `src/components/audio/GlobalAudioPlayerBar.js` | `href={storeLinkHref \|\| "/subscribe"}` |
| `src/context/AudioContext.js` | `STORE_LINK_HREF = "/subscribe"` |

Post-purchase upsell on homepage switches to Inner Circle tab; does not auto-open Stripe.

## Entitlement gating (unchanged)

- `resolveSubscriptionEntitlements(accountState, membership)` from `@/lib/commerce/entitlements`
- `showSubscribeButtons` hides CTAs for subscribers / lifetime owners
- `experienceUnlocked` still uses `isSubscriber` / `isLifetimeOwner`

## Grep validation (auto checkout)

- No `void startSubscription` in codebase
- No `checkoutStartedRef`
- No `useEffect` calling `startSubscription` or `setSubscriptionClientSecret` without user action in `src/`

## Build

```
npm run build — PASS (exit 0)
```

## Files changed

| File | Change |
|------|--------|
| `src/app/subscribe/page.js` | Removed auto-checkout `useEffect`, `checkoutStartedRef`, unused `isEligible` destructure |

## Success criteria checklist

- [x] Homepage Subscribe → `/subscribe` only (no Stripe on click)
- [x] Subscribe page does not open Stripe on load, route change, mount, or auth/eligibility change
- [x] Stripe opens only on explicit Subscribe button click
- [x] Entitlement rules unchanged (`showSubscribeButtons`, subscriber/lifetime hide)
- [x] Auth system untouched
- [x] `/api/memberships/checkout` route untouched
- [x] UI layout/styling untouched
- [x] `npm run build` passes
- [x] No remaining auto subscription checkout triggers in `src/`
