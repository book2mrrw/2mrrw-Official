# Ranked Root Causes — Playback Stability & State Churn

| Rank | Severity | Confidence | Root cause | Evidence |
|------|----------|------------|------------|----------|
| **RC-1** | **High** | **High** | Post-commerce **account-state polling storms** (`success` up to 8×, `subscribe` 5×/2.5s) re-render `AuthProvider` + `AudioProvider` during active listening | `success/page.js` L109–137; `subscribe/page.js` L66–74, L103–110 |
| **RC-2** | **High** | **High** | **`page.js` monolith subscribes to full `useAuth()`** — any entitlement delta re-renders ~61 `useState` hooks + catalog tree while audio plays | `page.js` L634–635, 61× `useState` |
| **RC-3** | **High** | **High** | **iOS visibility policy forces paused UI** without `RECOVER` — perceived “playback stopped” after lock/app switch | `AudioContext.js` L2935–2937 |
| **RC-4** | Medium | High | **Session recovery unconditionally `setQueue`** on mount — races with user-initiated playback | `useSessionRecovery.js` L61–64; `AudioPhase10Bridge.js` L37 |
| **RC-5** | Medium | High | **Triple `refreshAccountState` on AuthGate OTP** (`applySessionUser` + verify + `onVerified`) | `AuthGate.js` L324–328; `AppAuthRoot.js` L38–39 |
| **RC-6** | Medium | High | **`entitlements:updated` only on 2 checkout paths** — other purchases refresh state but may leave preview stream until manual replay | `entitlement-event-map.md`; collector/gift flows |
| **RC-7** | Medium | Medium | **`refreshAccountState` + `refreshLibrary` duplicate** library fetches and double `setState` waves | `AuthContext.js` L117–133 vs L135–168; paired calls across page |
| **RC-8** | Low | High | **`accountStateFetchingRef` returns null** to overlapping callers — success poll may read stale `owned` | `AuthContext.js` L136–137 |
| **RC-9** | Low | Medium | **Live countdown 1s interval on home** causes constant `page.js` re-renders | `page.js` L1090 |
| **RC-10** | Low | Medium | **Admin sync `useEffect`** second-patches `accountState` after refresh | `AuthContext.js` L337–355 |
