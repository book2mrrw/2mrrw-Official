# Auth State Timeline — T0 through T5

Assumes **admin fan with valid Supabase session** on home `/` (cold load). Timings are ordinal, not measured SLA.

---

## T0 — HTML / SSR

| Dimension | Value |
|-----------|--------|
| **Network** | Document HTML; no `/api/account/state` from server for entitlements |
| **AuthContext** | Not running (client provider) |
| **`user` / `isAdmin`** | N/A client-side |
| **`loading`** | N/A (defaults would be `true` if read) |
| **`authStatus`** | N/A |
| **Rerender estimate** | 0 client auth-driven |

**UI:** Server shell only. `AppAuthRoot` not hydrated → SSR path not used for gate (client-only).

---

## T1 — React hydrate + provider mount

| Dimension | Value |
|-----------|--------|
| **Network** | `bootstrapSession()` starts: `supabase.auth.getSession()`; possible localStorage `setSession` |
| **AuthContext** | `user: null`, `loading: true`, `accountState: EMPTY` |
| **`authStatus`** | `"loading"` |
| **AudioContext** | `authLoading: true`; `entitlementAccountState` = **EMPTY** (via hook) |
| **Rerender estimate** | AuthProvider ×1; AudioProvider ×1; AppAuthRoot ×1 |

**UI:** `AppAuthRoot` shows `BOOT_PLACEHOLDER` until `hydrated` (~1 frame). Then cinematic `children` visible under overlay-free loading state.

---

## T2 — Supabase session resolved (client)

| Dimension | Value |
|-----------|--------|
| **Network** | Bootstrap completes; `clearGuestSessionCookie` DELETE may fire |
| **AuthContext** | `setUser(adminUser)`, `setIsAdmin(true)` from `resolveUserFromSession` + `isAdminUser` |
| **`loading`** | Still `true` until account fetch finishes |
| **`authStatus`** | Still `"loading"` |
| **Rerender estimate** | AuthProvider ×1–2; all `useAuth` children including **page.js** (full tree), **AudioProvider** |

**UI:** Admin email/session exists in context but **entitlements still empty** in `useEntitlementAccountState`. Catalog may show preview/public access. `isAdmin` may enable gift affordances before library ready.

---

## T3 — `GET /api/account/state` in flight

| Dimension | Value |
|-----------|--------|
| **Network** | `fetch("/api/account/state", { cache: "no-store" })` — parallel DB on server |
| **AuthContext** | `accountStateFetchingRef` locked; duplicate refresh calls return early |
| **Server** | `getFanSessionUser` → admin profile; merges full digital `ownedSlugs` for admin |
| **Rerender estimate** | 0 until response (unless Strict Mode duplicate mount sets loading false early) |

**UI:** Frozen entitlement display (still EMPTY snapshot). No AuthGate (not unauthenticated).

---

## T4 — Account payload applied

| Dimension | Value |
|-----------|--------|
| **Network** | Response JSON applied |
| **AuthContext** | `applyAccountPayload`: library, ownedSlugs, membership, mediaProgress, permissions; shallow-equal may skip 1 update |
| **`useEffect` [isAdmin, userId]** | May merge `accountState.isAdmin` + `permissions.admin` |
| **`loading`** | Still true until bootstrap `finally` |
| **Rerender estimate** | AuthProvider ×1–3; page.js + AudioProvider + GlobalAudioPlayerBar + modals |

**UI:** Entitlement locks/unlocks animate in when hook flips from EMPTY → full. Admin My Music / vault flags populate. **Large catalog re-render** if many child components read `entitlementAccountState`.

---

## T5 — Bootstrap complete (`loading: false`)

| Dimension | Value |
|-----------|--------|
| **Network** | Idle unless polling routes (`/success`, `/subscribe`) |
| **`authStatus`** | `"authenticated"` (non-guest email) |
| **`AppAuthRoot`** | `showAuthGate: false` |
| **Session recovery** | `useSessionRecovery` may dispatch `2mrrw:playback-recovery` (parallel to T3–T5) |
| **Rerender estimate** | AuthProvider ×1; downstream ×N; **page.js** `accountStateReady` true → admin panels mount |

**UI:** Stable admin shell. `CollectorCardAdminPanel` appears (`accountStateReady && isAdmin`).

---

## Alternate timeline — Anonymous / guest

| Phase | Difference |
|-------|------------|
| T2 | `refreshGuest` instead of session user |
| T4 | Guest user in `accountState`; limited permissions |
| T5 | `authStatus: "unauthenticated"` → **AuthGate** overlay |

---

## Alternate timeline — `SIGNED_IN` after load

| Phase | Behavior |
|-------|----------|
| Listener | `applySessionUser` if new `user.id` |
| Network | Another `/api/account/state` + guest cookie clear |
| Playback | Same guards as T4; no automatic pause |

---

## Network waterfall (typical signed-in cold load)

```
T0  Document
T1  bootstrapSession (getSession [+ optional setSession])
T1  DELETE /api/guest/session (if signed in)
T3  GET /api/account/state
T5  (parallel) GET /api/catalog/hydrate?ids=...  [only if recovery snapshot exists]
```

---

## Rerender budget estimate (admin home)

| Stage | AuthProvider commits | page.js (approx) | AudioProvider |
|-------|---------------------|------------------|---------------|
| T1 | 1 | 1 | 1 |
| T2 | 1–2 | 1–2 | 1–2 |
| T4 | 1–3 | 1–3 | 1–3 |
| T5 | 1 | 1 + admin panel subtree | 1 |
| **Total** | **4–7** | **4–9** | **4–7** |

Playback element: **0 unmounts** (single hidden `<audio>` in `AudioProvider`).
