# State of Truth Matrix

**HEAD:** `34df134` | Phase 7 playback stability audit

---

## Legend

| Symbol | Meaning |
|--------|---------|
| **SOT** | Source of truth |
| **Mirror** | Derived; should follow SOT |
| **Shadow** | Independent copy; drift risk |
| **Advisory** | Diagnostics only |
| **Dead** | Not wired |

---

## Matrix

| State field | SOT | Mirrors | Shadow / stale risk | Notes |
|-------------|-----|---------|---------------------|-------|
| `audio.paused` / `audio.currentTime` | **`<audio>` element** (`audioRef`) | `stateRef.isPlaying`, `stateRef.currentTime` | — | React state updated via event listeners; brief lag possible |
| `isPlaying` (React) | **AudioContext** `patchState` / `onPlay`/`onPause` | `useMediaEngine().state.isPlaying`, GlobalAudioPlayerBar | `page.js` `miniPlayerPlaying` uses both `nowPlaying` + `isPlaying` | Viewport pause sets `isPlaying: false` via `onPause` |
| `currentTrack` | **AudioContext** `stateRef.currentTrack` | Media session metadata, bridge `currentTrack` | `page.js` `nowPlaying` | `nowPlaying` updated in effect L1230–1249 with modal gates |
| `playbackState` | **AudioContext** (`loading`, `playing`, `paused`, `preview_fallback`, …) | UI loaders, `AudioPhase10Bridge` seek deferral | — | |
| Queue / `queueIndex` | **AudioContext** `queueRef` + state | `usePlaybackRecovery` persist | Recovery event `queueIds` | Recovery skipped if session active |
| Stream URL | **`streamMetaRef` + `audio.src`** | `currentTrack.src` after resolve | — | Refresh can change src without track identity change |
| Viewport “was playing” | **refs** `wasPlayingBeforeViewportPauseRef`, `resumeEligibleRef`, `lastTrackIdRef` | — | — | Cleared by `clearViewportResume`, user pause, stop |
| In AV viewport? | **`isInAudioVisualViewportRef`** | — | trace `lastUiSection: audioVisuals` | Set true on enter, false on exit |
| User intent pause | **`userPausedRef`**, **`lastUserActionRef`** | — | — | Viewport pause does not set `userPausedRef` |
| Entitlements | **Supabase → `/api/account/state` → AuthContext `accountState`** | `useEntitlementAccountState()` | EMPTY while `loading` | UI must not authorize from client alone |
| `authLoading` | **AuthContext** | AudioContext `playTrackInternal` gates | — | Listener effect rebind when toggles |
| Preview vs full | **`track.metadata.access`** | `upgradeToFullStream` | — | Event-driven upgrade |
| Persisted session | **`recoveryStore` key `playback`** | — | — | Applied only when idle |
| Focus snapshot | **Dead:** `focus-controller.js` | — | — | Superseded by AudioContext refs |
| Forensics | **`playback-trace` ring** | `state-churn-log` | — | Advisory only |

---

## Consistency rules (expected vs actual)

| Rule | Expected | Actual at HEAD |
|------|----------|--------------|
| One `<audio>` for music | Yes | Yes — `AudioProvider` renders single element L3688+ |
| UI play button reflects audio | Mirror `isPlaying` | Mostly; page mini player adds `nowPlaying` slug gate |
| AV scroll pauses music | Yes (6B) | Yes — `enterAudioVisualViewport` |
| AV exit resumes if same track | Yes (6B) | Conditional — `shouldAutoResumeViewport` + `resumeFromViewport` |
| Auth refresh stops music | No | **Correct** — no pause on `refreshAccountState` |
| Entitlement upgrade during preview | Upgrade stream | **Yes** — may pause/swap src via `upgradeToFullStream` |
| Recovery restores active session | No | **Guarded** — `AudioPhase10Bridge` skips if `hasStarted \|\| queue.length` |

---

## `useEntitlementAccountState` loading sentinel

```441:446:src/context/AuthContext.js
export function useEntitlementAccountState() {
  const { accountState, loading } = useAuth();
  return useMemo(
    () => (loading ? EMPTY_ACCOUNT_STATE : accountState),
    [loading, accountState]
  );
}
```

**Conflict:** While `loading === true`, playback resolution in `page.js` and `playTrackInternal` sees **empty entitlements** → preview paths, lock UI, and post-load flips can change `metadata.access` mid-session → `entitlements:updated` → stream upgrade.

---

## Viewport resume eligibility (truth table)

`shouldAutoResumeViewport()` requires **all**:

| Condition | Ref / check |
|-----------|-------------|
| Was playing before viewport pause | `wasPlayingBeforeViewportPauseRef` |
| Resume allowed | `resumeEligibleRef` |
| User did not pause/stop | `lastUserActionRef` not `pause`/`stop` |
| Same track ID | `getCurrentTrackId()` === `lastTrackIdRef` |
| Session started | `hasStarted` |
| Document visible | `visibilityState === 'visible'` |
| Audio paused | `audio.paused` |

**Failure modes:** quick scroll in/out, track change during AV, background tab, user paused but ref not updated yet → **no resume** (by design, but feels like “playback died”).

---

## Desync hotspots (ranked)

1. **`nowPlaying` vs `currentTrack`** — `openFeatureModal` clears `nowPlaying` while starting new playback.
2. **Bridge snapshot vs React** — `useSyncExternalStore` caches until bridge notifies; progress via separate `usePlaybackProgress`.
3. **`onPause` auto-resume** vs viewport — race if `viewportPauseRef` cleared before classification.
4. **Direct `resumeInternal` vs queued `PLAY_TRACK`** — overlapping async work on same element.
