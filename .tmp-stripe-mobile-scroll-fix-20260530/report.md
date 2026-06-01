# Stripe Mobile Scroll Fix — 2026-05-30

## Summary

Shared scroll-safe shells (`stripePaymentOverlayStyle`, `stripePaymentPanelStyle`, `stripePaymentFormStyle`) ensure Stripe Elements modals scroll on iOS Safari / Android Chrome with `dvh`, safe-area insets, and touch momentum scrolling—without changing colors, typography, or payment logic.

## Mount points (5 modals + 2 forms)

| # | File | Overlay + panel | Form style |
|---|------|-----------------|------------|
| 1 | `src/components/payments/DonateModal.js` | Yes | via `CheckoutForm` |
| 2 | `src/app/subscribe/page.js` | Yes (+ `isMobile` @ 768px) | `SubscriptionPaymentForm` |
| 3 | `src/components/collectors-cards/CollectorCardModal.js` | Yes | via `CheckoutForm` |
| 4 | `src/app/page.js` (cart checkout ~2860) | Yes | via `CheckoutForm` |
| 5 | `src/components/payments/CheckoutForm.js` | N/A (child) | `stripePaymentFormStyle` |

**Excluded (intentional):** `src/app/StripeProvider.js` — app-wide provider wrapper, not a payment modal.

## Shell API (`src/components/payments/stripePaymentShell.js`)

- **Overlay:** `overflowY: auto`, `WebkitOverflowScrolling: touch`, mobile `alignItems: flex-end`, zero side padding on mobile sheets.
- **Panel:** `maxHeight: min(92dvh, calc(100dvh - safe areas - 16px))`, `overflowY: auto`, `overscrollBehavior: contain`, `minHeight: 0`.
- **Form:** `width: 100%`, `minWidth: 0`, `minHeight: 0` — prevents iframe row overflow inside scroll panels.

## Grep validation

```bash
rg 'stripePaymentOverlayStyle' src
# DonateModal.js, CollectorCardModal.js, page.js, subscribe/page.js

rg '<Elements' src
# DonateModal, CollectorCardModal, page.js, subscribe/page.js, StripeProvider.js (provider only)
```

All payment `<Elements>` mounts except `StripeProvider` use overlay + panel shells.

## Build

```
npm run build
# PASS — Next.js 16.2.4, compiled successfully
```

## Files changed

- `src/components/payments/stripePaymentShell.js` (new)
- `src/components/payments/DonateModal.js`
- `src/components/payments/CheckoutForm.js`
- `src/components/collectors-cards/CollectorCardModal.js`
- `src/app/page.js`
- `src/app/subscribe/page.js`

## Scope compliance

- No auth, API routes, webhook, or checkout logic changes.
- Visual design preserved; only container overflow, scroll, viewport (`dvh`), and safe-area padding adjusted.
