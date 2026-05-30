# Role Hierarchy and Inheritance

## Observed Effective Hierarchy

1. `admin` (hard override, full stream/catalog access)
2. `collector` / `collector_card` (full digital stream access + vault pass equivalent in account-state composition)
3. `subscriber` (membership active/trialing; broad catalog stream, but represented with mixed flags)
4. `owned` (purchase/gift/permanent ownership by slug)
5. `guest/public` (preview-only unless unlocked)

## Source Inputs Used

- Supabase/session identity: `getFanSessionUser`, `getGuestUser`, middleware session refresh
- Entitlement rows: `user_entitlements`, `entitlements` (product rows), `vault_entitlements`
- Legacy/parallel tables: `memberships`, `collector_ownerships`, `collector_access`, `library_items`
- Frontend state: `accountState.permissions`, `accountState.library`, `ownedSlugs`, `collectorOwnerships`

## Inheritance Rules Found

- `admin` implies full stream and hides purchase UI in access helpers.
- `collector` is inferred from:
  - explicit `collector_card` entitlement
  - collector ownership records with active/verified/granted statuses
  - legacy slug heuristics in some paths
- `subscriber` is inferred from:
  - membership status active/trialing
  - or `user_entitlements.subscriber`
- `vault` is elevated by:
  - explicit vault entitlement
  - collector card
  - some account-state composed fallbacks
- `owned` persists via permanent sources (`purchase`, `gift`, `grant`, `collector_unlock`) and is treated as durable through subscription churn.

## Admin Override Behavior

- Backend:
  - `/api/account/state` sets admin permissions and effectively full library projection.
  - `/api/library/stream` allows via `userCanStreamProduct` admin checks.
- Frontend:
  - `isAdminAccount`, `adminTrackAccess`, and route-driven permissions all provide admin fast paths.

Risk: admin policy is repeated in multiple places and should be centralized into one helper contract.
