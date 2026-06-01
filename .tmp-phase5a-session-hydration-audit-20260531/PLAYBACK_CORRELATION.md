# Playback Correlation — Hydration, Admin, Entitlements

Correlation levels: **HIGH** = plausible direct interrupt; **MEDIUM** = audible/queue change or skipped upgrade; **LOW** = re-render only or next-track only.

---

## Summary matrix

| Event | Playback stop | Queue change | Stream swap | UI flash | Level |
|-------|---------------|--------------|-------------|----------|-------|
| Cold bootstrap `refreshAccountState` | Unlikely | No | No | Yes (catalog) | **LOW** |
| `loading: true → false` | No | No | No | Yes | **LOW** |
| `useEntitlementAccountState` EMPTY→full | No* | No | No* | Yes | **LOW–MEDIUM** |
| Admin `ownedSlugs` expansion | No | No | On **next** `playTrack` | Yes | **LOW** |
| `entitlements:updated` + preview playing | No† | No | **Yes** (`upgradeToFullStream`) | Maybe | **MEDIUM** |
| `entitlements:updated` + `authLoading` | Skipped | No | No | — | **LOW** |
| `refreshAccountState` 401 | No immediate | No | Next play may 401 | Yes | **MEDIUM** |
| Session recovery `setQueue` | If race | **Yes** | Maybe | No | **LOW–MEDIUM** |
| `AudioProvider` re-render | No | No | No | No | **LOW** |
| Subscribe poll (no event) | No | No | Preview may remain | Yes | **LOW** |

\*Current element keeps playing; access metadata on **next** play may change.  
†Swaps URL; brief gap possible during `upgradeToFullStream`, not intentional stop.

---

## Evidence — no direct hydration stop

```156:200:src/context/AuthContext.js
  const refreshAccountState = useCallback(async (meta = {}) => {
    // ... fetch /api/account/state, applyAccountPayload — no audio APIs
```

```288:298:src/context/AuthContext.js
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        return;
      }
```

```3372:3384:src/context/AudioContext.js
  return (
    <AudioContext.Provider value={value}>
      <AudioPhase10Bridge />
      {children}
      <audio ref={audioRef} ... />
```

---

## Evidence — conditional playback effects

**Entitlement upgrade (preview → full):**

```2280:2305:src/context/AudioContext.js
  useEffect(() => {
    const onEntitlementsUpdated = (event) => {
      if (authLoading) return;
      if (meta?.previewOnly && stateRef.current.isPlaying) {
        void upgradeToFullStream();
      }
    };
    window.addEventListener("entitlements:updated", onEntitlementsUpdated);
```

**User ID sync (no pause):**

```606:607:src/context/AudioContext.js
  useEffect(() => {
    listeningUserIdRef.current = user?.id || null;
  }, [user?.id]);
```

**Media progress restore gated on auth:**

```1921:1931:src/context/AudioContext.js
    if (!resumeAt && !playedDifferentSince && !authLoading && entitlementAccountState?.mediaProgress?.length) {
```

**Recovery queue (skipped if active):**

```40:48:src/components/system/AudioPhase10Bridge.js
      if (hasStartedRef.current || activeQueue.length > 0) {
        logStateChurn("recovery-setQueue", { reason: "skipped-active-session", ... });
        return;
      }
```

---

## Admin-specific playback notes

- `/api/account/state` sets `finalOwnedSlugs` to **all digital products** for admin (`route.js` ~192–202).
- Does not invalidate current `<audio src>`; may change `resolveLibraryStreamForTrack` / access on **subsequent** plays.
- `upgradeToFullStream` requires matching `entitlementAccountState.user.id` and `listeningUserIdRef` — if account user arrives after client user set, first upgrade event may **fail silently** until another dispatch (only 2 call sites today).

---

## Session recovery vs auth hydration race

Parallel on load:

1. `AuthProvider` bootstrap → `refreshAccountState`
2. `useSessionRecovery` → hydrate catalog → `2mrrw:playback-recovery`

If fan had **saved queue** but **no active playback** (`hasStarted === false`, empty in-memory queue), recovery may `setQueue` while entitlements still EMPTY → first play might preview until account state lands.

**Correlation:** **LOW–MEDIUM** for edge restore scenarios; **LOW** for typical cold play after load.

---

## Recommended instrumentation (read-only ops)

Filter dev console:

- `[state-churn] refreshAccountState`
- `[state-churn] entitlements:updated`
- `[state-churn] upgradeToFullStream`
- `[state-churn] recovery-setQueue`
- `[playback-resilience]` stream errors after hydration
