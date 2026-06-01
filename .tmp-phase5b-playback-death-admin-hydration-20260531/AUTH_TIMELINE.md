# Auth Timeline — Initial Load → Admin

**Files:** `src/context/AuthContext.js`, `src/components/auth/AppAuthRoot.js`, `src/auth/authService.js` (bootstrap), `src/app/api/account/state/route.js`

---

## T0 — Server HTML

- `AppAuthRoot` renders `BOOT_PLACEHOLDER` (black `minHeight: 100vh`) — auth `useEffect` does not run on server (`AppAuthRoot.js` L38–39).

---

## T1 — Client hydration (0–~50ms)

| Event | State |
|-------|-------|
| `AppAuthRoot` `useEffect` | `hydrated=true` → children visible |
| `AuthProvider` | `loading: true`, `user: null`, `isAdmin: false` |
| `useEntitlementAccountState` | Returns **`EMPTY_ACCOUNT_STATE`** (not stale guest) L441–446 |

---

## T2 — Bootstrap once (`sessionBootstrappedRef`)

| Branch | Actions |
|--------|---------|
| Resolved Supabase user | `setUser`, `setIsAdmin`, `clearGuestSessionCookie`, `refreshAccountState()` |
| No user | `refreshGuest()` → may set guest user + `refreshAccountState` |
| Finally | `setLoading(false)` L280–281 |

**Skipped on `TOKEN_REFRESHED` / `INITIAL_SESSION`:** no entitlement re-fetch L295–297.

---

## T3 — `/api/account/state` response (admin)

| Server | Client `applyAccountPayload` |
|--------|------------------------------|
| `permissions.admin` | `isAdminFlag`, `permissions.admin=true` L101–104 |
| `adminFullLibrary` | Injects all digital products into library L156–178 |
| `finalOwnedSlugs` all digital slugs | L192–202 |
| `user` object | Merged; guest preserved if server sends guest L120 |

**Second render wave:** `accountState` populated → `entitlementAccountState` no longer EMPTY → catalog/access UI updates.

---

## T4 — `isAdmin` sync effect (L362–380)

When `isAdmin || userId`, patches `accountState.isAdmin` and `permissions.admin` without full refetch.

---

## T5 — Steady state (admin)

| Field | Typical value |
|-------|---------------|
| `loading` | `false` |
| `authStatus` | `authenticated` |
| `isAdmin` | `true` |
| `ownedSlugs` | All digital product slugs |
| `user` | Supabase user (non-guest email) |

---

## Guest → signed-in admin (OTP / magic link)

| Step | Event |
|------|-------|
| 1 | `SIGNED_IN` → `applySessionUser` |
| 2 | `setUser`, `setIsAdmin`, clear guest cookie |
| 3 | `refreshAccountState` single fetch (OTP triple-fetch removed per Phase 2) |
| 4 | `notifyEntitlementsUpdated` only on commerce pages — not automatic on sign-in |

---

## Parallel: Session recovery

| Time | `useSessionRecovery` |
|------|----------------------|
| Same mount window | May dispatch `2mrrw:playback-recovery` |
| AudioPhase10Bridge | `setQueue` only if no active session |

---

## Timeline diagram

```
t=0     SSR placeholder
t=1     hydrate → shell visible, loading=true, EMPTY entitlements
t=2     bootstrapSession completes
t=3     refreshAccountState → full accountState (admin slugs)
t=3+    loading=false → catalog/admin UI snap
(par)   playback-recovery event → setQueue if idle
```

---

## Instrumentation (dev)

Filter console: `[state-churn] refreshAccountState`, `kind` transitions on `AuthContext` apply.
