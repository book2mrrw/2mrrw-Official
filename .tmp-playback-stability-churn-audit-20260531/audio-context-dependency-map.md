# AudioContext — Cross-Context Dependency Map

## Auth / entitlement inputs

| Source | Usage in AudioContext |
|--------|----------------------|
| `useAuth().user` | `listeningUserIdRef` (position save, listening history) |
| `useAuth().loading` → `authLoading` | Skips server `mediaProgress` restore; blocks `entitlements:updated` handler |
| `useEntitlementAccountState()` | `mediaProgress` for resume-at; `user?.id` in `upgradeToFullStream` / stream resolve |

**Critical:** `AudioProvider` calls both hooks at top level (L497–498). Any `AuthContext` value change re-runs **entire** `AudioProvider` (~3200 lines), including `useMemo` value rebuild when `state` changes.

## Entitlement → playback paths

| Path | Mechanism | When |
|------|-----------|------|
| Preview → full | `window` event `entitlements:updated` | After checkout on `page.js` / `success/page.js` |
| Handler | `upgradeToFullStream()` if `previewOnly && isPlaying` | L2191–2202 |
| Stream resolve | `entitlementAccountState?.user?.id` in `resolveLibraryStreamForTrack` | Each play / upgrade |
| Resume position | `entitlementAccountState.mediaProgress` | `playTrack` when no local saved position |
| 401 on account | **Not handled in AudioContext** | Auth clears user; playback may continue until error |

## Queue / stream / recovery

| Component | Role |
|-----------|------|
| `AudioPhase10Bridge` | Child of provider; `usePlaybackRecovery`, `2mrrw:playback-recovery` listener, queue preloader |
| `useSessionRecovery` | Sibling under layout; dispatches recovery event on mount |
| `setQueue` | Recovery handler may **replace** queue from sessionStorage snapshot |
| `upgradeToFullStream` | Swaps `src` on same element; does not remount `<audio>` |
| Stream meta refresh | On `visibilitychange` hidden if URL needs refresh | Background signed URL refresh |

## Timers affecting playback

| Timer | Interval | Purpose |
|-------|----------|---------|
| Position save | 15s (`POSITION_SAVE_INTERVAL_MS`) | `savePlaybackPosition` when playing |
| Keep-alive | 20s | SW `KEEP_ALIVE` postMessage |
| Progress RAF | rAF while playing | UI progress (via `subscribeProgress`) |
| Queue watchdog | timeout | Stuck queue detection |

## Mobile lifecycle (AudioContext)

| Event | Behavior |
|-------|----------|
| `visibilitychange` → hidden | Save position; refresh stream URL if expiring; record `wasPlayingBeforeHideRef` |
| `visibilitychange` → visible | iOS: **force pause state** (`isPlaying: false`) — no auto RECOVER; non-iOS: `RECOVER` command if paused but state says playing |
| `pageshow` (bfcache) | `rehydrateMediaSession` |
| `pagehide` | Save position (no pause by itself) |

## Does auth refresh stop audio?

- `refreshAccountState` / `applyAccountPayload`: **No explicit stop**
- Provider re-render: `<audio ref={audioRef}>` preserved — element not destroyed
- Risk: effect re-runs, in-flight `playTrack` / stream race during entitlement poll storms

## GlobalAudioPlayerBar

Uses `useAudioPlayer()` — re-renders when AudioContext `value` changes (`state` includes progress-related fields in provider; progress uses `subscribeProgress` for bar — verify bar uses subscription).

## Dependency list (auth → audio)

1. `user.id` → position persistence eligibility  
2. `authLoading` → defer server progress restore; gate entitlement upgrade event  
3. `accountState.mediaProgress` → resume-at on play  
4. `accountState.user.id` → stream API identity  
5. `entitlements:updated` (custom) → preview upgrade (not from refresh alone)
