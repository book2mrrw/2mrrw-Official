# Recovery System Findings

## Architecture

```
layout.js
  SessionRecoveryRoot → useSessionRecovery() [mount once]
  AudioProvider
    AudioPhase10Bridge → usePlaybackRecovery() + 2mrrw:playback-recovery listener
```

## useSessionRecovery (`system/recovery/useSessionRecovery.js`)

| Aspect | Detail |
|--------|--------|
| **When fires** | Once on mount (empty deps `useEffect`) |
| **Reads** | `recoveryStore.load("playback")` — `queueIds`, `queueIndex`, `currentTime` |
| **Network** | `GET /api/catalog/hydrate?ids=…` then `refreshSignedUrlsForQueue` |
| **Dispatches** | `2mrrw:playback-recovery` with `{ …playback, tracks }` |
| **Cancelled** | Strict Mode cleanup sets `cancelled` — may abort dispatch on double mount |

## AudioPhase10Bridge handler

| Aspect | Detail |
|--------|--------|
| **Action** | `setQueue(tracks, queueIndex)` — **replaces entire queue** |
| **Seek** | If `currentTime > 0`, polls up to 40×75ms until not loading, then `seek` |
| **onRestore in usePlaybackRecovery** | **No-op** `() => {}` — persistence writes only |

## Queue overwrite risk

| Condition | Risk |
|-----------|------|
| User starts playback before recovery event processes | **High** — `setQueue` replaces active queue |
| User already has queue from current session | Snapshot from localStorage may be **stale** (older session) |
| Hydrate partial failure | Falls back to stub tracks with generic stream URLs |
| Race: play + recovery event | Last writer wins — audible glitch or wrong track |

**Mitigation (not implemented):** Skip recovery if `hasStarted` or queue non-empty; merge instead of replace.

## usePlaybackRecovery

| Aspect | Detail |
|--------|--------|
| Persist trigger | `queue` / `queueIndex` change + 5s interval when `hasStarted` |
| Storage key | `"playback"` in recovery store |
| Playback impact | Writes only; no pause |

## 2mrrw:playback-recovery vs entitlements:updated

Independent channels — both can run near checkout/home load:

1. Recovery restores old queue  
2. Entitlement upgrade swaps preview → full on **current** track  

If recovery runs after upgrade, may reset queue to saved snapshot.

## useScrollRecovery

Sibling in `SessionRecoveryRoot` — scroll position only; no audio interaction (not expanded in this audit).

## Diagnostic codes (recovery failures)

- `RECOVERY_HYDRATE_FAILED`  
- `RECOVERY_SIGNED_URL_REFRESH_FAILED`  

Logged via `reportPlaybackDiagnostic`; non-fatal.
