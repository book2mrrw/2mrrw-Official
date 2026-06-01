# Part 2 — AudioProvider Stability

**Question:** Can `AudioProvider` unmount/remount? Is `audioRef` recreated? Do keys change? Do route/auth changes recreate the tree?

---

## Provider tree (current `layout.js`)

```
AuthProvider                    [src/app/layout.js L43–58]
  AudioProvider                 [L44–45 — sibling parent to AppAuthRoot]
    AppAuthRoot                 [L45 — children only; placeholder does NOT wrap AudioProvider]
      AuthGateProvider
        SessionRecoveryRoot
          StripeProvider
            MediaErrorBoundary → {children}
    GlobalAudioPlayerBar        [L56 — outside AppAuthRoot, inside AudioProvider]
```

**Finding:** `AudioProvider` and the hidden `<audio>` element are **not** descendants of `AppAuthRoot`'s hydration placeholder. A brief `BOOT_PLACEHOLDER` (L38–40 `AppAuthRoot.js`) replaces **page content only**, not the audio engine.

**Correction vs older Phase 5A wording:** Prior notes that bootstrap "unmounts the entire tree including AudioProvider" are **stale** relative to current `layout.js`; re-verified 2026-05-31.

---

## Unmount / remount paths

| Scenario | AudioProvider unmounts? | Evidence |
|----------|-------------------------|----------|
| Normal navigation within app | **No** | Providers in root layout only; no route-segment layout duplicate |
| `AppAuthRoot` `!hydrated` placeholder | **No** | Placeholder is inside `AppAuthRoot`; `AudioProvider` is parent |
| Auth state updates (`user`, `accountState`) | **No** | Re-render only; same provider instance |
| React Strict Mode (dev) | **Possible double mount** | Same as any root provider; `sessionBootstrappedRef` limits auth re-bootstrap (`AuthContext.js` L258–286) |
| Full document navigation (`window.location.*`) | **Yes** (whole app) | User-initiated; not home scroll |
| `MediaErrorBoundary` error | **No** | Fallback null for **children** only; boundary comment L17–18 `MediaErrorBoundary.js` |
| No `key=` on `AuthProvider` / `AudioProvider` | **Stable identity** | Grep: only mount sites `layout.js` L43–44 |

---

## `audioRef` lifecycle

| Property | Behavior | Evidence |
|----------|----------|----------|
| Creation | `const audioRef = useRef(null)` once per `AudioProvider` mount | `AudioContext.js` L526 |
| DOM binding | Single `<audio ref={audioRef} ...>` | L3376–3383 |
| Recreated on re-render? | **No** | `useRef` persists across commits |
| Destroyed without unmount? | **No** separate destroy path | `stopInternal` pauses/clears state L2684+; does not remove element |

`perfMark(MARKS.PLAYBACK_PROVIDER_MOUNT)` L609–611 and `PLAYBACK_AUDIO_ELEMENT_READY` L613–617 fire on mount/ref attach — useful for confirming single mount in traces.

---

## Auth coupling inside `AudioProvider`

```javascript
const { user, loading: authLoading } = useAuth();
const entitlementAccountState = useEntitlementAccountState();
```

| Effect | Pauses / destroys audio? | Location |
|--------|--------------------------|----------|
| `user?.id` → `listeningUserIdRef` | No | L605–607 |
| `authLoading` gates media-progress restore | No pause | L1921, L2174 |
| `entitlements:updated` + preview → `upgradeToFullStream` | Stream swap, not unmount | L2280–2305 |
| Visibility handler | Save position; optional RECOVER on visible | L3040–3162 |

**No** `useEffect` that calls `stopInternal` or removes `<audio>` when `authLoading` flips.

---

## Session recovery vs active playback

`AudioPhase10Bridge.js` L41–48: `2mrrw:playback-recovery` → `setQueue` **skipped** if `hasStartedRef` or active queue length > 0.

`useSessionRecovery` dispatches recovery event on mount (`useSessionRecovery.js` L16–66) — cannot replace queue during active session by design.

---

## Route / auth tree recreation

| Mechanism | Recreates provider tree? |
|-----------|--------------------------|
| Next.js `router.push` / `replace` on home | No — same root layout |
| `router.refresh()` | Soft RSC refresh; **client providers persist** | Only `verify-otp/page.js` L124 |
| `AuthContext` value identity | `useMemo` L393–429 — new object when deps change; **does not unmount** `AudioProvider` |

---

## Files / functions (Part 2 index)

| File | Symbols |
|------|---------|
| `src/app/layout.js` | `RootLayout`, provider nesting |
| `src/context/AudioContext.js` | `AudioProvider`, `audioRef`, `<audio>`, visibility effect |
| `src/components/auth/AppAuthRoot.js` | Hydration placeholder scope |
| `src/components/system/AudioPhase10Bridge.js` | Recovery `setQueue` guard |
| `src/system/recovery/useSessionRecovery.js` | Recovery event dispatch |
