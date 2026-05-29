# Auth boot blank screen fix — 2026-05-28

## 1. Exact reason app not rendering

Production showed a blank screen because **`AppAuthRoot` replaced the entire React tree** during auth bootstrap:

1. While `loading === true`, it returned only an empty `<div>` (no `{children}`), so `page.js`, `AudioProvider`, and the cinematic shell never mounted.
2. After loading, when the user was not OTP-authenticated, it returned **only** `<AuthGate />` with no `{children}` underneath — again zero shell.

Hydration could complete at the layout level, but the fan-facing UI never rendered. Any entitlement or playback code under `children` never ran; the failure mode looked like a total app blackout, not an auth modal on top of the world.

`AuthContext` itself was not the primary blocker; session bootstrap and OTP loop fixes (fe3fa3b) were correct but could not help while the root gate swallowed children.

## 2. Deadlock / cycle found

| Issue | Location | Notes |
|--------|-----------|--------|
| **Render gate (P0)** | `AppAuthRoot.js` | `if (loading) return <div/>` and `if (!authenticated) return <AuthGate/>` without children |
| **SSR vs client split** | `AppAuthRoot.js` | On server, `loading` stays `true` (no `useEffect`), so children never SSR'd — avoids TDZ in audio/media chunk. Mounting children unconditionally breaks `next build` prerender (`Cannot access 'bh' before initialization`). **Fix:** post-hydration mount (`hydrated` flag) — SSR placeholder matches first paint, then shell + overlay. |
| **Stub gate context** | `AuthGateContext.js` | `AuthGateProvider` stubs `isAuthenticated: true` — not the blank-screen cause; root gate lives in `AppAuthRoot` |
| **TDZ (media bundle)** | 22af588 | Circular media imports reduced; full provider tree still must not SSR until hydration gate |

## 3. Files changed

| File | Change |
|------|--------|
| `src/components/auth/AppAuthRoot.js` | After hydration, always render `{children}`; `AuthGate` overlay when `authStatus === 'unauthenticated'`; SSR-safe placeholder until `hydrated` |
| `src/context/AuthContext.js` | Export `authStatus: 'loading' \| 'unauthenticated' \| 'authenticated'`; complete `DEFAULT_AUTH_CONTEXT`; derive status via `isOtpAuthenticated` |
| `src/context/AuthGateContext.js` | Safe `user?.email` in `isOtpAuthenticated` |

**Not changed:** OTP send/verify, `AuthGate.js` form logic, media/playback, visual layout.

## 4. Confirmation checklist

- [x] `npm run build` succeeds locally
- [x] `AppAuthRoot` never returns without `{children}`
- [x] `authStatus` tri-state exported from `AuthContext`
- [x] OTP gate preserved (`AuthGate` `variant="root"` overlay when unauthenticated)
- [x] `page.js` already guards entitlements with `accountStateReady = !authLoading`
- [ ] Manual: production deploy — shell visible under gate; sign-in completes; no TDZ in console
- [ ] Manual: iOS Safari session restore still works after overlay sign-in
