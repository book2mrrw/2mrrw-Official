# Auth readiness guard fix — 2026-05-28

## Status

**Complete.** Entitlement/auth consumption guards wired across shell, playback, and library paths.

## Root cause (production crash class)

1. **Stale partial `accountState` during `loading`** — Guest/session bootstrap can populate `accountState` before OTP session is final. Entitlement helpers (`resolveTrackAccess`, `resolveContentAccess`, `getPlayButtonState`) ran on that partial state during first client renders, causing wrong access flags and, in minified builds, Safari-reported `ReferenceError: Cannot access uninitialized variable` when combined with hydration timing.

2. **Incomplete prior patch** — `useEntitlementAccountState` returned `{}` while loading (missing `library`, `ownedSlugs`, `permissions`), and `page.js` had a duplicate `entitlementAccountState` binding that **broke production builds**.

3. **Unsafe account tab derefs** — `currentUser.email` without optional chaining in account UI.

4. **mediaProgress restore during auth bootstrap** — `AudioContext` restored server progress from partial `accountState` before session was ready.

**Why prod-only:** Minified bundles reorder evaluation; first-paint entitlement calls run before `loading` flips false. SSR placeholder in `AppAuthRoot` delays full tree until hydration, sharpening the client-only race.

## Fixes applied

| File | Lines (approx) | Change |
|------|----------------|--------|
| `src/context/AuthContext.js` | 441–446 | `useEntitlementAccountState()` returns `EMPTY_ACCOUNT_STATE` while `loading` (not `{}`); export `membership` on context value |
| `src/app/page.js` | 532–533, 1015–1172, 1102–1104, 1536–1537, 1595–1653, 1845, 1907–2786, 2418, 2423 | Single `useEntitlementAccountState()`; all catalog/modal/play paths use `entitlementAccountState`; `currentUser?.email`; admin panel uses raw `accountState` only when `accountStateReady` |
| `src/context/AudioContext.js` | 381, 1584–1585, 1775–1776, 1871–1882 | `authLoading` from `useAuth`; skip `mediaProgress` restore while loading; entitlements upgrade effect gated on `!authLoading` |
| `src/hooks/useMusicLibrary.js` | 20 | Uses `useEntitlementAccountState()` for library partitioning |
| `src/lib/playback/playback-gate.js` | 13–37 | Optional chaining on `accountState` fields |
| `src/app/subscribe/page.js` | 42, 135–137 | Guard membership unlock UI until `!authLoading` |

**Not touched:** OTP send/verify, R2/stream routes, playback resolver graph.

## Verification

- [x] `npm run build` — success (2026-05-29)
- [x] No duplicate `entitlementAccountState` binding in `page.js`
- [x] `useEntitlementAccountState` grep: `AuthContext.js`, `page.js`, `useMusicLibrary.js`
- [x] `page.js` entitlement paths: modals, singles rail, catalog grids, carousel, gift sheet — all `entitlementAccountState`
- [x] `page.js` admin-only: `CollectorCardAdminPanel` waits for `accountStateReady`, passes raw `accountState`
- [x] `AudioContext.js`: `mediaProgress` restore skipped when `authLoading`
- [x] `playback-gate.js`: optional chaining on account fields (caller supplies guarded state)
- [x] `useMusicLibrary.js`: uses hook
- [ ] Manual: signed-out → shell + OTP overlay; play buttons show preview until session ready
- [ ] Manual: signed-in subscriber → full stream without refresh crash

## Remaining risk

`AppAuthRoot` still shows a brief SSR/hydration placeholder before shell mounts (required to avoid media-bundle TDZ on prerender per `cd7bf9b`). Entitlement UI may flash preview for ~1 frame until `loading` clears — acceptable vs crash.
