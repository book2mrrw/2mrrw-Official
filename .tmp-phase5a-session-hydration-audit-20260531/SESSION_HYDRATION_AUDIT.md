# Phase 5A — Session Hydration & Account-State Transition Audit

**Date:** 2026-05-31  
**Scope:** Read-only. No code changes.  
**Repo:** `/Users/recharge/artist-platform`

---

## Executive summary

Session hydration is a **two-phase client bootstrap**: Supabase session resolution (`authService.bootstrapSession`) then entitlement hydration (`GET /api/account/state` via `refreshAccountState`). Playback is **mostly insulated** from auth churn: `refreshAccountState` does not touch queue/audio; `TOKEN_REFRESHED` / `INITIAL_SESSION` are ignored; recovery `setQueue` is skipped when a session is already active.

The highest-impact user-visible issues are **UI entitlement flashes** (`useEntitlementAccountState` returns empty snapshot while `loading`) and **large `page.js` re-renders** when `accountState`/`library` populate—especially for **admin**, where `/api/account/state` expands `ownedSlugs` to the full digital catalog.

Playback interruption from hydration alone is **LOW** on cold load; **MEDIUM** when `entitlements:updated` fires during preview playback (stream swap via `upgradeToFullStream`).

---

## S1 — Session hydration flow

| Step | File | Function / hook | Trigger | State updated | Components affected |
|------|------|-----------------|---------|---------------|---------------------|
| 1 | `src/app/layout.js` | `RootLayout` | First document load | None (SSR shell) | All routes |
| 2 | `src/auth/authService.js` | `bootstrapSession()` | `AuthProvider` mount (once per module) | Module singleton `bootstrapComplete`; optional `setSession` from localStorage | None directly |
| 3 | `src/auth/authService.js` | `getSession` / `restoreSessionFromStorage` | Inside bootstrap | Supabase client session | — |
| 4 | `src/context/AuthContext.js` | `useEffect` bootstrap IIFE | `AuthProvider` mount | `user`, `isAdmin`, then `accountState` via fetch | All `useAuth` / `useEntitlementAccountState` consumers |
| 5 | `src/context/AuthContext.js` | `resolveUserFromSession` | After session resolved | Filters guest emails `@guest.2mrrw.local` | — |
| 6 | `src/context/AuthContext.js` | `clearGuestSessionCookie` | Signed-in path | DELETE `/api/guest/session` | Guest cookie cleared |
| 7 | `src/context/AuthContext.js` | `refreshAccountState` | After user set OR guest path | `user`, `isAdmin`, `library`, `ownedSlugs`, `accountState` | Catalog, modals, audio entitlement hooks |
| 8 | `src/app/api/account/state/route.js` | `GET` | `fetch` from client | Server JSON only | — |
| 9 | `src/lib/auth/session-user.js` | `getFanSessionUser` | Server route | Supabase user + profile OR guest cookie user | — |
| 10 | `src/lib/auth/constants.js` | `isAdminUser` | Client + server | `isAdmin` flag, `permissions.admin`, admin library merge | Admin UI, full catalog slugs |
| 11 | `src/context/AuthContext.js` | `setLoading(false)` | Bootstrap `finally` | `loading`, `authStatus` | `AppAuthRoot`, `page.js`, `AudioContext` |
| 12 | `src/components/auth/AppAuthRoot.js` | `useEffect` hydrated | Client hydration | `hydrated` local state | Placeholder → children; optional `AuthGate` |
| 13 | `src/context/AuthContext.js` | `useEntitlementAccountState` | Any auth consumer | Memo: `EMPTY` while loading else `accountState` | Catalog access, preview CTAs, `AudioContext` |

**Guest branch (no Supabase fan session):** `refreshGuest()` → `POST/GET /api/guest/session` → `refreshAccountState`.

**Auth listener:** `subscribeAuthState` → `SIGNED_IN` (new user id) → `applySessionUser` → `refreshAccountState`. `TOKEN_REFRESHED` / `INITIAL_SESSION` → **no-op** (no entitlement re-fetch).

---

## S2 — Guest → Admin transition

### Why guest UI can appear first

1. **Initial React state:** `user: null`, `loading: true`, `accountState: EMPTY_ACCOUNT_STATE`.
2. **`AppAuthRoot`:** Until `hydrated`, shows black full-screen placeholder (not guest-specific).
3. **`authStatus`:** While `loading`, status is `"loading"` — **AuthGate does not show** (`showAuthGate` only when `unauthenticated`).
4. **True guest path:** No Supabase session → `refreshGuest` → `user.isGuest === true` → after load, `authStatus === "unauthenticated"` → **AuthGate overlays** the cinematic shell.

### Admin at initial render?

**No.** Admin identity is not in SSR HTML. Admin is derived client-side:

- **T1 (early):** `resolveUserFromSession` + `isAdminUser(user)` from Supabase session (email/id/role).
- **T2 (later):** `/api/account/state` confirms `permissions.admin`, merges full digital `ownedSlugs`, may set `accountState.isAdmin`.

### Expected behavior

| Scenario | Guest UI? | Admin UI? | Notes |
|----------|-----------|-----------|-------|
| Anonymous visitor | AuthGate after load | No | Expected |
| Guest cookie session | AuthGate + guest entitlements | No | `authStatus` unauthenticated |
| Admin with Supabase session | No gate if session before `loading=false` | `isAdmin` often true before `accountStateReady` | Gift affordances vs `CollectorCardAdminPanel` gated on `accountStateReady` |
| Admin slow session restore | Brief null user | Delayed admin panels | Perceived “logged out” until bootstrap completes |

### Remounts / providers

Provider order in `layout.js`: `AuthProvider` → `AudioProvider` → `AppAuthRoot` → … → `SessionRecoveryRoot`. **No provider remount** on auth state change; only React re-renders. Strict Mode: bootstrap guarded by `sessionBootstrappedRef` + `authService` module singleton; second mount sets `loading` false without re-fetch storm.

### Staggered admin UI (`page.js`)

- `isAdmin` from context: available when `user` + `isAdminUser` set.
- `accountStateReady = !authLoading`: gates `CollectorCardAdminPanel`, `showOwnTrackConversion`.
- `entitlementAccountState`: **empty** until `loading` false → catalog locks flip when real `accountState` arrives.

---

## S3 — Auth state timeline (summary)

See `AUTH_STATE_TIMELINE.md` for T0–T5 tables (network, context, rerender estimates).

---

## S4 — Playback impact (AudioProvider / AudioContext)

| Mechanism | Interrupts playback? | Evidence |
|-----------|---------------------|----------|
| `refreshAccountState` on bootstrap | **NO** (typical cold load) | No `pause`/`setQueue` in `AuthContext.js` |
| `AuthProvider` value change → `AudioProvider` re-render | **NO** | Audio state in `useState`/`refs`; `<audio>` not unmounted |
| `user?.id` change | **NO** | `listeningUserIdRef` update only (`AudioContext.js` ~606) |
| `authLoading` true | **Indirect** | Defers `mediaProgress` resume in `playTrack`; skips `entitlements:updated` handler |
| `entitlements:updated` | **CONDITIONAL** | `upgradeToFullStream` if `previewOnly && isPlaying` — swaps stream, does not clear queue |
| `upgradeToFullStream` user mismatch | **YES** (upgrade skipped) | Requires `serverUserId === clientUserId` (~2187) |
| Session recovery `2mrrw:playback-recovery` | **CONDITIONAL** | `setQueue` only if `!hasStarted && queue.length === 0` (`AudioPhase10Bridge.js`) |
| 401 on `refreshAccountState` | **Possible** | Clears auth state; does not call `signOut` on audio — fan may lose stream access on next play |
| `TOKEN_REFRESHED` ignored | **NO** | By design in `AuthContext` listener |

**Verdict:** Hydration alone **does not** stop active playback. Risk rises with **preview + purchase** (`entitlements:updated`) or **recovery race** on tab restore.

---

## S5 — `refreshAccountState` callers

| Caller | File | Trigger | Frequency | Coalescing |
|--------|------|---------|-----------|------------|
| Bootstrap | `AuthContext.js` | Mount, signed-in | 1× per session | `accountStateFetchingRef` |
| `applySessionUser` | `AuthContext.js`, `AuthGate.js`, `verify-otp/page.js` | OTP verify | Per sign-in | Same |
| `refreshGuest` / `enterGuest` | `AuthContext.js` | Guest entry | Per action | Sequential |
| `page.js` | Checkout, library change, preview | User/commerce | Many call sites | Parallel calls may no-op if fetch in flight |
| `success/page.js` | Mount | Purchase return | Up to 3 polls (1s/2s/4s) | + `refreshLibrary` each |
| `subscribe/page.js` | `?subscribed=1`, modal success | Subscription | Up to 3 polls (0/2.5s/5s) | No `entitlements:updated` |
| `useMusicLibrary` | `refresh()` | My Music | On demand | + library |
| Collector/gift flows | `CollectorCardModal`, `gift/[token]`, `collector/activate` | Activation | Per completion | — |

**Does not dispatch** `entitlements:updated` (only `notifyEntitlementsUpdated` from `page.js` checkout + `success/page.js`).

**Duration:** Single `GET /api/account/state` — server runs parallel Supabase queries (library, membership, products, collector, mediaProgress, entitlements). Client blocks concurrent duplicate via ref until `finally`.

---

## S6 — `entitlements:updated`

| Role | Location | Behavior |
|------|----------|----------|
| Dispatcher | `notifyEntitlementsUpdated` in `state-churn-log.js` | 400ms dedup window |
| Call sites | `page.js` `handleCheckoutSuccess`; `success/page.js` poll attempt 0 | 2 production paths |
| Listener | `AudioContext.js` `useEffect` | `upgradeToFullStream` if not `authLoading` and preview playing |
| Side effects on page | None direct | Indirect via refreshed `accountState` from paired `refreshAccountState` |
| Subscribe page | Polls only | No event — preview may persist until replay |

---

## S7 — Rerender hotspots

See `RERENDER_HOTSPOTS.md`. Top consumer: **`page.js`** (monolith, 10+ auth-derived props). **`AudioProvider`** re-renders on every auth context change but preserves playback state.

---

## S8 — Playback correlation

See `PLAYBACK_CORRELATION.md`.

| Axis | Level |
|------|-------|
| Bootstrap / `refreshAccountState` | **LOW** |
| `useEntitlementAccountState` flip | **LOW** (current track); **MEDIUM** (next play resolution) |
| `entitlements:updated` | **MEDIUM** |
| Session recovery vs hydration | **LOW–MEDIUM** |
| Admin catalog slug expansion | **LOW** (playback); **HIGH** (UI) |

---

## S9 — Root cause ranking

See `ROOT_CAUSE_RANKING.md`.

---

## S10 — Recommendations (no implementation)

### Safe

- Enable `[state-churn]` logging (`NEXT_PUBLIC_STATE_CHURN_LOG=1`) and trace admin cold load + checkout.
- Document expected admin flash: `isAdmin` before `accountStateReady` is intentional split.
- Add manual test matrix: cold load playing, checkout while preview playing, return from `/success` while home tab plays.

### Medium risk

- Split `AuthContext` value: stable actions vs entitlement snapshot to reduce `AudioProvider`/`page.js` coupling.
- Dispatch `notifyEntitlementsUpdated` from shared post-purchase helper (subscribe, collector, gift) when `ownedSlugs` gains slugs.
- Gate session recovery dispatch until `!authLoading` to avoid hydrate/recovery ordering races.

### High risk

- SSR-hydrate admin entitlements (touches auth architecture).
- Remove `useEntitlementAccountState` EMPTY guard without replacing stale-entitlement protection.
- Merge bootstrap + account/state into one endpoint without cache invalidation strategy.

---

## Key file index

| File | Role |
|------|------|
| `src/context/AuthContext.js` | Session bootstrap, account state, entitlements |
| `src/auth/authService.js` | Supabase singleton bootstrap, auth listeners |
| `src/app/layout.js` | Provider tree order |
| `src/components/auth/AppAuthRoot.js` | Hydration gate + AuthGate overlay |
| `src/app/page.js` | Primary auth consumer + commerce refresh |
| `src/context/AudioContext.js` | Playback + entitlement listener |
| `src/app/api/account/state/route.js` | Entitlement source of truth |
| `src/lib/diagnostics/state-churn-log.js` | Churn log + `notifyEntitlementsUpdated` |
| `src/components/system/AudioPhase10Bridge.js` | Recovery `setQueue` |
| `src/system/recovery/useSessionRecovery.js` | Playback recovery orchestration |
