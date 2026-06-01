# Rerender Hotspots — AuthContext consumers

`AuthProvider` memoizes `value` but **any** change to `user`, `library`, `ownedSlugs`, `accountState`, `loading`, `isAdmin`, etc. produces a new context reference → all `useAuth()` subscribers re-render.

---

## Top 10 consumers (by blast radius)

| Rank | File | Hook | Auth fields used | Blast radius |
|------|------|------|------------------|--------------|
| 1 | `src/app/page.js` | `useAuth` + `useEntitlementAccountState` | `currentUser`, `library`, `owns`, `accountState`, `membership`, `isAdmin`, `authLoading`, refresh fns | **Entire home shell** — carousel, grids, modals, checkout, admin panels |
| 2 | `src/context/AudioContext.js` | `useAuth` + `useEntitlementAccountState` | `user`, `authLoading`, full entitlement snapshot | Whole playback subtree + `AudioPhase10Bridge` |
| 3 | `src/components/audio/GlobalAudioPlayerBar.js` | `useEntitlementAccountState` | Entitlements for stream/access UI | Fixed bar on every route |
| 4 | `src/components/preview/ImmersivePreviewModal.js` | `useEntitlementAccountState` | Access resolution in modal | Heavy modal when open |
| 5 | `src/hooks/useMusicLibrary.js` | `useAuth` + `useEntitlementAccountState` | `library`, `mediaProgress`, loading | **My Music** tab via `MyMusicTab.js` |
| 6 | `src/components/auth/AppAuthRoot.js` | `useAuth` | `authStatus` only | Gate overlay toggle |
| 7 | `src/app/subscribe/page.js` | `useAuth` | `accountState`, `membership`, `accountLoading`, refresh | Subscribe UX + polling |
| 8 | `src/app/success/page.js` | `useAuth` | `refreshAccountState`, `refreshLibrary` | Post-purchase poll loop |
| 9 | `src/components/collectors-cards/CollectorCardModal.js` | `useAuth` | `currentUser`, `owns`, refresh | Modal + purchase flow |
| 10 | `src/components/preview/PreviewEndedCTA.js` | `useEntitlementAccountState` | Entitlement CTA | Preview end overlay |

**Honorable mention:** `AuthGate.js` (`applySessionUser` only) — localized until OTP completes.

---

## `page.js` specific hotspots

| Pattern | Lines (approx) | Effect |
|---------|----------------|--------|
| `entitlementAccountState` passed to grids/rails | 1986–2860 | Every account update re-renders catalog children |
| `authLoading` in deep-link `useEffect` | 1678 | Re-runs when loading clears |
| `accountStateReady` gates | 1687–1688, 2524–2525 | Admin panel mount/unmount |
| `useMemo` on `showSubscribeCta` | 638–640 | Recomputes when entitlement snapshot changes |
| Inline `onLibraryChange` lambdas | Many | New function refs → child memo bypass |

---

## Mitigations already in codebase

| Guard | Location | Effect |
|-------|----------|--------|
| `accountStateShallowEqual` | `AuthContext.applyAccountPayload` | Skips `setAccountState` if entitlements unchanged |
| `libraryItemsShallowEqual` / `slugSetsEqual` | `setLibrary`, `setOwnedSlugs` | Reduces churn when slugs stable |
| `useEntitlementAccountState` EMPTY while loading | `AuthContext.js` | Prevents **stale** entitlements; causes **empty→full** flip |
| `accountStateFetchingRef` | `refreshAccountState` | Drops concurrent duplicate fetches |
| OTP path | `authService` | No triple refresh on verify (Phase 2) |

---

## AudioProvider vs page.js

`AudioProvider` wraps `AppAuthRoot` in `layout.js` → **auth updates re-render AudioProvider even when only `page.js` needs new entitlements**. Playback refs survive; work is wasted reconciliation + effect dependency checks (`authLoading`, `entitlementAccountState?.mediaProgress`).

---

## Strict Mode

Second mount: `sessionBootstrappedRef` prevents second bootstrap fetch; `setLoading(false)` on remount. May still cause **duplicate** child mount effects in dev.
