# Recovery Audit — SessionRecoveryRoot, useSessionRecovery, AudioPhase10Bridge

---

## Mount order (`layout.js`)

```
AuthProvider
  AudioProvider          ← single <audio>, AudioPhase10Bridge inside
    AppAuthRoot
      AuthGateProvider
        SessionRecoveryRoot   ← useSessionRecovery + useScrollRecovery
          children
    GlobalAudioPlayerBar
```

Recovery runs **inside** auth shell but **does not** wrap AudioProvider.

---

## useSessionRecovery (`src/system/recovery/useSessionRecovery.js`)

| Step | Action |
|------|--------|
| Mount | `store.load("playback")` |
| If `queueIds.length` | `GET /api/catalog/hydrate?ids=...` |
| Then | `refreshSignedUrlsForQueue` |
| Dispatch | `window.dispatchEvent("2mrrw:playback-recovery", { detail })` |
| Flag | `isRecovering` → false |

**Timing:** Parallel with `AuthProvider` bootstrap `refreshAccountState` — no ordering guarantee.

---

## AudioPhase10Bridge (`src/components/system/AudioPhase10Bridge.js`)

| Component | Role |
|-----------|------|
| `useQueuePreloader` | Preload upcoming queue URLs |
| `usePlaybackRecovery` | Persist snapshot; `onRestore` noop |
| Recovery listener | L35–86 |

### Queue overwrite conditions

**`setQueue` runs ONLY when ALL true:**

1. Event `2mrrw:playback-recovery` received  
2. `detail.queueIds.length > 0`  
3. `hasStartedRef.current === false`  
4. `activeQueue.length === 0`  

**Skipped (logged `recovery-setQueue` reason `skipped-active-session`):** fan already playing or in-memory queue non-empty L41–48.

### Post-restore seek

If `detail.currentTime > 0`, polls until `!hasStarted || !currentTrack || loading states` then `seek()` L66–81 — **does not auto-play**.

---

## SessionRecoveryRoot (`src/components/system/SessionRecoveryRoot.js`)

Thin wrapper: `useSessionRecovery()` + `useScrollRecovery()` — scroll restore is **DOM scroll position**, not audio.

---

## Race with auth hydration

| Scenario | Risk |
|----------|------|
| Active playback on reload | Recovery **skipped** — safe |
| Abandoned queue, no `hasStarted` | `setQueue` with placeholder stream URLs L54–58 | **LOW–MEDIUM** — may overwrite empty queue before user taps play |
| Entitlements still EMPTY | Restored tracks use `/api/library/stream?slug=` — first play may preview until account state lands | **LOW** |
| Recovery during modal play | `hasStarted` true → skip | **LOW** |

**Does not call `pause()` or `stop()`.**

---

## Playback death correlation

| Question | Answer |
|----------|--------|
| Scroll repro stop? | **No** — guards prevent overwrite while playing |
| Cold load stop? | **No** — unless user had stale recovery + separate play failure |
| Queue replaced mid-song? | **Ruled out** when `hasStarted \|\| queue.length` |
