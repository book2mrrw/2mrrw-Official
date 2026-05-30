# 12 — Bundle Splitting (Route Chunks, Admin/Vault Leakage)

## Build tooling

**package.json scripts:** `build`, `dev`, `start` — no `analyze` script  
**No `@next/bundle-analyzer`** installed

## Route-based splitting (App Router)

Static pages generate separate client reference manifests (~42 KB each) but **shared chunks dominate**:
- Root main files: 5 chunks including turbopack runtime
- Home page (`/`) pulls largest shared bundle via monolithic page.js

## Shared chunk analysis

| Chunk | ~Size | Contents |
|-------|-------|----------|
| 0r51.50eo84zj.js | 329 KB | framer-motion + stripe |
| 0k2c51m0ti.7f.js | 211 KB | supabase |
| 0qji6969z_g_l.js | 184 KB | posthog |
| 0b3030qv56zb-.js | 131 KB | framer-motion |

## Leakage: admin code in fan storefront

**Static import:** `src/app/page.js` L17
```javascript
import CollectorCardAdminPanel from "@/components/admin/CollectorCardAdminPanel";
```

Rendered conditionally by `isAdmin` but **included in main bundle regardless**.

**File:** `src/components/admin/CollectorCardAdminPanel.js` — admin UI, API calls to `/api/admin/*`

## Leakage: vault / shop / gifts

All tabs bundled in page.js:
- `VaultUnlockedRoom` — static import L35
- `GiftBottomSheet`, `GiftsSentSection` — static
- Printful shop logic in page effects

User on Home tab still downloads Music/Vault/Shop tab code.

## Positive patterns

- `DonateModal` — `dynamic(..., { ssr: false })` (page.js L8)
- Satellite routes (`/subscribe`, `/login`) — separate page chunks
- API routes — zero client weight

## three.js

In package.json but **not imported in src** — no bundle leakage (tree-shaken).

## howler

In package.json — grep shows no active imports in src (AudioContext uses native `<audio>`).

## Recommendations scope (planning only)

See `prioritized-remediation-plan.md` for:
- Dynamic import admin panel
- Tab-level code splitting
- Bundle analyzer setup

## Validation checklist

- [ ] Add `@next/bundle-analyzer` in validation phase — map page.js import graph
- [ ] Compare `/` vs `/login` first-load JS bytes
- [ ] Verify admin chunk absent when dynamic import applied (future)
