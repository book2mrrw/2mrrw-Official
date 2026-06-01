# Entitlement Snapshot Architecture

**Date:** 2026-06-01  
**Baseline:** `ab00180`  
**Scope:** `AuthContext` entitlement cache + refresh gating (no auth redesign, no playback API changes).

## Snapshot shape (`entitlementSnapshotRef`)

Populated only after a successful `/api/account/state` fetch — never recomputed on render.

| Field | Source |
|-------|--------|
| `userId` | Session user id |
| `subscriberActive` | API `subscriberActive` |
| `collectorCard` | API `collectorCard` |
| `ownedSlugs` | API `ownedSlugs` (array copy) |
| `permissions` | API `permissions` (shallow copy) |
| `vaultAccess` | API boolean / vault detail |
| `lastUpdated` | `Date.now()` at commit |
| `version` | Monotonic counter per successful commit |

## React sync

- `applyAccountPayload` updates React `accountState` with `accountStateShallowEqual` guards (Phase 2).
- `commitEntitlementSnapshot` updates the ref and bumps `entitlementSnapshotVersion`.
- `useEntitlementAccountState` merges snapshot entitlement fields over `accountState` when not `loading`.

## Public API

| Export | Role |
|--------|------|
| `refreshAccountState({ reason?, force?, source? })` | Gated fetch; returns API payload or cached snapshot shape |
| `getEntitlementSnapshot()` | Read-only copy of current snapshot |
| `invalidateEntitlementSnapshot(reason)` | Sets `lastUpdated` to `0` so debounce does not block the next allowed refresh |
| `useEntitlementAccountState()` | UI/playback entitlement view (bootstrap → `EMPTY_ACCOUNT_STATE`) |

## Modules

- `src/context/AuthContext.js` — provider, snapshot ref, gating orchestration
- `src/lib/auth/entitlement-refresh-gating.js` — allowlist, normalize legacy reasons, snapshot builders
- `src/lib/auth/state-equality.js` — shallow equality (unchanged contract)
- `src/lib/diagnostics/state-churn-log.js` — `[ENTITLEMENT-REFRESH-BLOCKED]` dev logs

## Audio safety

`AuthContext` does not import `AudioContext` or call `pause`, `setQueue`, or `upgradeToFullStream`. Entitlement refresh remains a network + React state path only.
