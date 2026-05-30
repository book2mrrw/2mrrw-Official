# 10 — Client Hydration Audit ("use client" Boundaries, Oversized Trees)

## Root layout — server component with client providers

**File:** `src/app/layout.js` — Server Component importing client providers:
- `StripeProvider`, `AuthProvider`, `AudioProvider`, `AppAuthRoot`, `GlobalAudioPlayerBar`, etc.

All routes hydrate this provider tree.

## Primary page boundary

**File:** `src/app/page.js`
- Line 1: `"use client"`
- **2,777 lines** — entire storefront in one client boundary
- Imports: framer-motion, Stripe, 40+ components, hooks, lib modules

**Assessment:** Maximum client boundary — no server component wrapper for static shell sections.

## Auth hydration gate

**File:** `src/components/auth/AppAuthRoot.js`
- Shows `BOOT_PLACEHOLDER` until `hydrated` state true (useEffect)
- Then renders children + optional AuthGate overlay
- **Flash:** black screen → full app

## Other routes

| Route | Client? | Notes |
|-------|---------|-------|
| `/subscribe/page.js` | Yes | Checkout flow |
| `/login/page.js` | Yes | Auth |
| `/gift/[token]/page.js` | Yes | Gift reveal |
| API routes | Server | No hydration |

## "use client" file count

~120+ files in `src/` contain `"use client"` (components, hooks, contexts, pages).

## Dynamic import usage (sparse)

**Only DonateModal** dynamically imported in page.js:
```javascript
const DonateModal = dynamic(() => import("@/components/payments/DonateModal"), { ssr: false });
```

**Not dynamic:** ImmersivePreviewModal, VaultUnlockedRoom, CollectorCardAdminPanel, GiftBottomSheet, CheckoutForm.

## Oversized trees

```
html
└── body
    └── AuthProvider
        └── AppAuthRoot [hydration gate]
            └── AuthGateProvider
                └── AudioProvider [2974 lines logic]
                    └── SessionRecoveryRoot
                        └── StripeProvider
                            └── page.js [2777 lines UI]
                            └── GlobalAudioPlayerBar
```

Single reconciliation root for storefront + playback state.

## Findings

1. **page.js should be split** into tab-level client islands (future work — not implemented here).
2. **Hydration placeholder** adds one paint cycle before content.
3. **ImmersivePreviewModal (1152 lines)** statically imported — paid even when modal closed.
4. **No RSC for catalog metadata** — all catalog fetching client-side post-hydration.

## Validation checklist

- [ ] React 19 Profiler: hydration duration for Page
- [ ] Compare JS executed with modal never opened vs opened
