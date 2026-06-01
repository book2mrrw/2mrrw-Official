# Part 1 — Auth Bootstrap Trace

**Question:** Initial load → Supabase → AuthContext → account state → admin. Guest pricing first? Admin later? `user` null? `accountState` cleared? `ownedSlugs` empty? Intentional reset?

---

## Timeline (signed-in admin, cold load on `/`)

| Phase | `user` | `loading` | `authStatus` | `accountState` / entitlements hook | `ownedSlugs` |
|-------|--------|-----------|--------------|-----------------------------------|--------------|
| T0 SSR | N/A (client providers) | N/A | N/A | N/A | N/A |
| T1 Provider mount | `null` | `true` | `"loading"` | `EMPTY_ACCOUNT_STATE` via `useEntitlementAccountState` | empty `Set` |
| T2 Session resolved | admin `user` set | `true` | `"loading"` | still **EMPTY** (hook gated on `loading`) | still empty until T4 |
| T3 `/api/account/state` in flight | admin | `true` | `"loading"` | EMPTY | empty |
| T4 Payload applied | admin | `true` → `false` in `finally` | → `"authenticated"` | full library, slugs, permissions | populated |
| T5 Stable | admin | `false` | `"authenticated"` | full | populated |

**Evidence:** `AuthProvider` initial state and bootstrap effect — `src/context/AuthContext.js` L71–76, L245–311; entitlement gate — L440–446.

---

## Answers

| Question | Answer | Evidence |
|----------|--------|----------|
| Guest pricing first? | **Yes, effectively** while `loading === true` | `useEntitlementAccountState()` returns `EMPTY_ACCOUNT_STATE` until bootstrap `finally` sets `loading: false` (`AuthContext.js` L440–446). Catalog uses `entitlementAccountState` on `page.js` L637. |
| Admin later? | **Yes** — after `applyAccountPayload` + `loading: false` | `applyAccountPayload` L85–125; admin `isAdmin` from server permissions L97–104; `page.js` `accountStateReady = !authLoading` L1687. |
| `user` null initially? | **Yes** | `useState(null)` L71. |
| `accountState` cleared? | **Starts empty**; cleared on 401 / sign-out / failed guest | `EMPTY_ACCOUNT_STATE` L14–27; `refreshAccountState` 401 path L169–176; `clearAuthenticatedState` L248–255; `signOut` L347–352. |
| `ownedSlugs` empty initially? | **Yes** | `useState(new Set())` L73; EMPTY includes `ownedSlugs: []` L16. |
| Intentional reset? | **Yes** — EMPTY gate during load; hard reset on auth loss | Documented in hook comment L440; 401 and SIGNED_OUT paths intentional. |

---

## Bootstrap call chain

```
RootLayout AuthProvider mount
  → useEffect (once per provider; Strict Mode remount skips re-bootstrap) L245–311
    → bootstrapSession()          [auth/authService.js — module singleton L36–38]
    → resolveUserFromSession()    [AuthContext.js L64–68]
    → if resolved:
         setUser, setIsAdmin, clearGuestSessionCookie L56–61, refreshAccountState L272
    → else:
         refreshGuest L275
    → finally: setLoading(false) L280–282
  → subscribeAuthState L289–305
    → TOKEN_REFRESHED / INITIAL_SESSION: no-op L296–298
    → SIGNED_IN (new user id): applySessionUser L299–304
    → SIGNED_OUT: clearAuthenticatedState L291–294
```

---

## Guest vs authenticated paths

| Path | Trigger | Functions |
|------|---------|-----------|
| Signed-in fan | `bootstrapSession` returns real email | `resolveUserFromSession`, `refreshAccountState` |
| Anonymous | No Supabase user | `refreshGuest` L203–224 → may POST guest cookie |
| OTP / login after load | `SIGNED_IN` | `applySessionUser` L226–237 |
| Guest entry | `enterGuest` L313–334 | POST `/api/guest/session`, `refreshAccountState`; optional `window.location.href` redirect L325–330 |

`authStatus` L384–391: guests and missing session → `"unauthenticated"` → `AppAuthRoot` shows `AuthGate` overlay L27–47 (`AppAuthRoot.js`).

---

## Admin-specific behavior

- `isAdmin` set from `isAdminUser(user)` on session resolve L270 and from server `permissions.admin` in `applyAccountPayload` L97–104.
- Secondary merge effect L362–380 patches `accountState.isAdmin` when `isAdmin` / `userId` change.
- `page.js`: `isAdmin` can show gift affordances before `accountStateReady`; `CollectorCardAdminPanel` gated by `accountStateReady && isAdmin` L2525.

---

## TOKEN_REFRESHED / account sync during playback

- **No** `refreshAccountState` on `TOKEN_REFRESHED` or `INITIAL_SESSION` (L296–298).
- `refreshAccountState` invoked from: bootstrap, `applySessionUser`, `enterGuest`, `page.js` checkout/library callbacks, `success/page.js` poll, `subscribe/page.js` poll — none tied to home scroll.

---

## Files / functions (Part 1 index)

| File | Functions / symbols |
|------|---------------------|
| `src/context/AuthContext.js` | `AuthProvider`, `applyAccountPayload`, `refreshAccountState`, `refreshGuest`, `applySessionUser`, `useEntitlementAccountState`, `resolveUserFromSession`, `EMPTY_ACCOUNT_STATE` |
| `src/auth/authService.js` | `bootstrapSession`, `subscribeAuthState` |
| `src/components/auth/AppAuthRoot.js` | `AppAuthRoot` — `authStatus`, hydration gate |
| `src/app/api/account/state/route.js` | Server entitlement source (not client reset) |
| `src/app/page.js` | `useAuth`, `entitlementAccountState`, `accountStateReady` |
