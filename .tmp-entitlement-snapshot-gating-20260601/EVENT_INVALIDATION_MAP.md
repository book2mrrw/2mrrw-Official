# Event Invalidation Map

## Snapshot invalidation (`invalidateEntitlementSnapshot`)

| Event | Location | Reason passed |
|-------|----------|---------------|
| Session bootstrap (signed-in) | `AuthContext` bootstrap effect | `auth:bootstrap` |
| OTP / session apply | `applySessionUser` | `auth:login` |
| Guest enter | `enterGuest` | `auth:login` |
| Inline checkout success | `page.js` `handleCheckoutSuccess` | `purchase:completed` |
| `/success` first poll | `success/page.js` attempt 0 | `purchase:completed` |
| Sign out / 401 | `clearEntitlementSnapshot` | (full clear) |

## Refresh without invalidate (debounce applies)

| Event | Reason | Source |
|-------|--------|--------|
| Catalog library mutation | `library:change` | `page.js`, `useMusicLibrary` |
| Collectors grid passive refresh | `collector:updated` | `CollectorsCardsGrid` |

## Refresh with `force: true` (commerce / auth)

| Event | Reason | Source |
|-------|--------|--------|
| Bootstrap / guest chain | `auth:bootstrap` | `AuthContext` |
| Login / guest enter | `auth:login` | `AuthContext` |
| Checkout / success poll | `purchase:completed` | `page.js`, `success/page.js` |
| Subscribe poll | `subscription:updated` | `subscribe/page.js` |
| Collector activate / modal | `collector:updated` | `collector/activate`, `CollectorCardModal` |
| Gift redeem | `purchase:completed` | `gift/[token]` |

## `entitlements:updated` (unchanged Phase 2)

| Site | Helper |
|------|--------|
| `success/page.js` first poll | `notifyEntitlementsUpdated` (400ms dedup) |
| `page.js` checkout success | `notifyEntitlementsUpdated` |

Does not call `invalidateEntitlementSnapshot` — separate window dispatch for `AudioContext` listeners.

## OTP paths (no extra refresh)

`verify-otp` / `AuthGate` → `applySessionUser` only (single forced `auth:login` refresh inside AuthContext).
