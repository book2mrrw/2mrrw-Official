# Global Subscription Entitlement Gating

**Date:** 2026-05-30  
**Scope:** Subscribe CTA visibility + subscribe page/checkout alignment (no auth/UI redesign)

## Entitlement source of truth

Shared helper: `resolveSubscriptionEntitlements()` in `src/lib/commerce/entitlements.js`

| Signal | Derivation |
|--------|------------|
| `isSubscriber` | `accountState.subscriberActive` OR `membershipHasPremiumAccess(membership)` |
| `isLifetimeOwner` | `accountState.collectorCard` |
| `showSubscribe` / `isEligible` | `!isSubscriber && !isLifetimeOwner` |

Uses `useEntitlementAccountState()` where account state must not flash stale guest entitlements during bootstrap.

---

## Files changed

| File | Change |
|------|--------|
| `src/lib/commerce/entitlements.js` | Added `resolveSubscriptionEntitlements()` shared helper |
| `src/app/subscribe/page.js` | Refactored to use shared helper (behavior unchanged from prior simplify) |
| `src/app/page.js` | Gated home Subscribe button + post-purchase membership upsell modal |
| `src/components/preview/ImmersivePreviewModal.js` | Gated preview modal Subscribe icon link |
| `src/components/preview/PreviewEndedCTA.js` | Gated Subscribe link in preview-ended CTA |
| `src/components/audio/GlobalAudioPlayerBar.js` | Gated player “get access” subscribe link on access denied |
| `src/app/api/memberships/checkout/route.js` | Uses `getFanSessionUser()` (session identity); removed guest-only email/phone gate message |

---

## Part 1 — Subscribe button locations

| Location | Component / surface | Change |
|----------|---------------------|--------|
| Home hero actions | `src/app/page.js` (~L1933) | Subscribe button wrapped in `showSubscribeCta` |
| Post-purchase upsell | `src/app/page.js` (~L2807) | Modal only opens/renders when `showSubscribeCta` |
| Subscribe page (×2) | `src/app/subscribe/page.js` | Already gated via `showSubscribeButtons` — now uses shared helper |
| Preview modal | `src/components/preview/ImmersivePreviewModal.js` (~L705) | Subscribe icon link hidden when entitled |
| Preview ended CTA | `src/components/preview/PreviewEndedCTA.js` | Subscribe link hidden when entitled |
| Global audio player | `src/components/audio/GlobalAudioPlayerBar.js` (~L571) | “get access” subscribe link hidden when entitled |

### Not changed (intentional)

| Location | Reason |
|----------|--------|
| `MyMusicTab.js` copy (“Subscribe to build playlists…”) | Informational text, not a Subscribe button/CTA |
| `AudioContext.js` `STORE_LINK_HREF` constant | Link target unchanged; visibility gated at render site (player bar) |
| Admin / gift / vault pricing labels | Not user-facing Subscribe CTAs |
| Auth system (`authService`, `AuthGate`, OTP, session) | Out of scope per rules |

---

## Part 2 — Subscribe page status

Built on `.tmp-subscribe-entitlement-simplify-20260530/`:

- [x] No email/username inputs
- [x] No login/signup UI
- [x] No auth checks or redirects
- [x] Eligible users → Stripe checkout POST on load, Elements modal mounts immediately
- [x] Subscribers / collector-card owners → unlocked message, Subscribe buttons hidden, no Stripe fetch

---

## Part 3 — Stripe checkout API

`POST /api/memberships/checkout`:

- Resolves user via `getFanSessionUser()` (OTP session first, guest cookie fallback)
- No request-body email/username collection
- User identity fields in Stripe metadata come from session profile only
- Error when no session: `"Account session unavailable"` (401) — not a UI auth redirect

Stripe payment form on subscribe page still uses Stripe Elements / Express Checkout (provider-level email for wallets) — unchanged.

---

## Part 4 — Cross-platform consistency

| Check | Status |
|-------|--------|
| Same helper used across all Subscribe CTAs | PASS |
| Home page uses single shell (`page.js`) for web + mobile (`isMobile` branches share `showSubscribeCta`) | PASS |
| Preview modal / player bar are shared components (not platform-forked) | PASS |
| No platform-specific auth exceptions added | PASS |
| App auth shell untouched | PASS |

---

## Build

```
npm run build — PASS (exit 0)
```

---

## Success criteria

| Criterion | Result |
|-----------|--------|
| Subscribe shown only when NOT subscriber AND NOT lifetime owner | **PASS** |
| All Subscribe button/link instances gated consistently | **PASS** |
| Subscribe page entitlement-only (no auth UI/checks) | **PASS** |
| Checkout uses session identity only | **PASS** |
| Auth system untouched | **PASS** |
| UI design/layout unchanged (conditional render only) | **PASS** |
| Cross-platform same logic | **PASS** |
| Production build passes | **PASS** |

---

## Optional artifact

Zip: `/Users/recharge/Downloads/subscribe-global-entitlement-20260530.zip`
