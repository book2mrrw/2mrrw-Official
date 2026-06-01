# AuthContext — Dependency & Churn Map

## Provider state (each update can rebuild context value)

| State | Setter trigger | In `useMemo` value deps? |
|-------|----------------|--------------------------|
| `user` | Bootstrap, SIGNED_IN, refreshAccountState, guest, signOut | Yes |
| `library` | refreshAccountState, refreshLibrary, signOut | Yes |
| `ownedSlugs` | Same (new `Set` each time) | Yes |
| `accountState` | applyAccountPayload, refreshLibrary, admin sync effect, signOut | Yes |
| `isAdmin` | Session, refresh, markAdmin, signOut | Yes |
| `loading` | Bootstrap `finally` | Yes |
| `authStatus` | Derived from `loading` + `user` | Yes |

**Context value:** Single `useMemo` (L368–404) — any dep change → **new object** → all consumers re-render.

## Secondary hook: `useEntitlementAccountState`

```416:422:src/context/AuthContext.js
export function useEntitlementAccountState() {
  const { accountState, loading } = useAuth();
  return useMemo(
    () => (loading ? EMPTY_ACCOUNT_STATE : accountState),
    [loading, accountState]
  );
}
```

While `loading === true`, returns stable `EMPTY_ACCOUNT_STATE` reference. After load, tracks full `accountState` object identity.

## Consumers (`useAuth` in src)

| Consumer | Fields used | Playback impact |
|----------|-------------|-----------------|
| `app/page.js` | `currentUser`, `library`, `owns`, `accountState`, `membership`, `isAdmin`, `signOut`, `refreshLibrary`, `refreshAccountState`, `authLoading` | **Full page re-render** on any auth dep change |
| `context/AudioContext.js` | `user`, `authLoading` + `useEntitlementAccountState()` | **AudioProvider re-render**; effects on `user?.id`, `mediaProgress`, `entitlements:updated` |
| `app/success/page.js` | `refreshLibrary`, `refreshAccountState` | Isolated route |
| `app/subscribe/page.js` | `accountState`, `membership`, `refreshAccountState`, `accountLoading` | Subscribe page only |
| `app/verify-otp/page.js` | `applySessionUser`, `refreshAccountState` | OTP route |
| `components/auth/AuthGate.js` | `applySessionUser`, `refreshAccountState` | Overlay on home when unauthenticated |
| `components/auth/AppAuthRoot.js` | `authStatus`, `refreshAccountState` | Gates shell + hydration |
| `hooks/useMusicLibrary.js` | `user`, `library`, `loading`, refresh fns + entitlement hook | My Music subtree |
| Collector / gift pages | Narrow subsets | Route-local |

**Consumer file count:** 14 files under `src/` (including `AuthContext.js` test export).

## Admin sync effect (extra churn)

`useEffect` L337–355 patches `accountState` when `isAdmin` / `userId` / `user` change — can cause **second** `accountState` update after `refreshAccountState` completes.

## TOKEN_REFRESHED / INITIAL_SESSION

Explicitly **no-op** (L271–272) — avoids refresh storms on background token refresh. Good for playback stability.

## Narrowing recommendations (report only)

1. Split context: **session** (`user`, `authStatus`, `loading`) vs **entitlements** (`accountState`, `library`, `owns`) — page could subscribe to entitlements only where needed.
2. Stabilize `ownedSlugs` exposure (e.g. ref + version counter) to avoid Set identity churn if contents unchanged.
3. Remove duplicate `refreshAccountState` after `applySessionUser` in OTP paths (E17–E19).
4. Coalesce `refreshAccountState` + `refreshLibrary` into one server endpoint or single client helper to halve network + single `applyAccountPayload`.

## page.js interaction

`page.js` uses both `useAuth()` and `useEntitlementAccountState()` — **double subscription** to auth changes. Entitlement props passed to large subtrees (`FeaturesRail`, `CatalogGrid`, etc.) amplify render cost when `accountState` updates during playback.
