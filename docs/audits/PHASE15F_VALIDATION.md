# Phase 15F — Lifecycle health gate validation

**Scope:** `src/context/AudioContext.js` (lifecycle visibility / bfcache paths only).  
**Goal:** Stop unconditional `runCoalescedLifecycleRecovery` when `track && hasStarted` on iOS return; recover only when transport is actually unhealthy.

## `evaluateLifecyclePlaybackHealth({ resumeAfter })`

Returns `{ healthy: boolean, reason: string }`.

| Check | Unhealthy reason |
|-------|------------------|
| No `currentTrack` | `no_track` |
| `!hasStarted` | `not_started` |
| No `<audio>` | `no_audio_element` |
| `audio.ended` | `ended` |
| `AudioContext.state === "suspended"` | `audio_context_suspended` |
| Web Audio ctx exists and not `running` | `audio_context_not_running` |
| `resumeAfter === false` (fan paused before hide) | **healthy** — `transport_ok_paused` |
| `resumeAfter === true` | Requires `isAudioActuallyAudible()` after `updateAudibilitySample` |
| Audible | **healthy** — `audible` |
| Expected play but `audio.paused` | `paused_expected_playing` |
| Expected play, `readyState < 2` | `not_ready` |
| Expected play, otherwise | `not_audible` |

Suspended Web Audio context is always **unhealthy** (feeds gesture-unlock path on visibility before health skip).

## Behavior matrix (A–F)

| Case | Trigger | Preconditions | Recovery? | Trace / log |
|------|---------|---------------|-----------|-------------|
| **A** | `visibilitychange` → visible | `track`, `hasStarted`, `resumeAfter`, playback audible, ctx running | **No** | `LIFECYCLE_HEALTHY_SKIP_RECOVERY` when `NEXT_PUBLIC_PLAYBACK_TRACE` or dev |
| **B** | `visibilitychange` → visible | Same, but frozen / not audible / paused while `resumeAfter` | **Yes** | `visibility-recovery` (existing) |
| **C** | `visibilitychange` → visible | `resumeAfter`, ctx still `suspended` after `ensureWebAudioRunning` | **Yes** (`gesture_unlock_required`) | `gesture-unlock-required` (15D preserved) |
| **D** | `visibilitychange` → visible | `track`, `hasStarted`, fan paused before hide (`!resumeAfter`) | **No** | `LIFECYCLE_HEALTHY_SKIP_RECOVERY` (`transport_ok_paused`) |
| **E** | `pageshow` `persisted` (bfcache) | Healthy transport (same evaluator) | **No** | `BFCACHE_HEALTHY_SKIP_RECOVERY` |
| **F** | `pageshow` `persisted` | Unhealthy | **Yes** | `bfcache-restore` (existing) |

## Preserved (unchanged)

- Lifecycle recovery lock / dedup (`lifecycleRecoveryLockRef`, `LIFECYCLE_RECOVERY_LOCK_MS`)
- `requestPlaybackRecovery` in-flight dedup
- Audibility watchdog interval (`AUDIBILITY_WATCHDOG_MS`) and truth-violation recovery
- Phase 15D: `gesture_unlock_required` branch when ctx remains suspended on visibility return (runs **before** health skip)

## Confirmations

- [x] `evaluateLifecyclePlaybackHealth` uses `audibilitySampleRef` + `isAudioActuallyAudible` for `resumeAfter` paths
- [x] Visibility: health gate runs after gesture-unlock attempt, before `runCoalescedLifecycleRecovery`
- [x] Bfcache: health gate before `runCoalescedLifecycleRecovery`
- [x] Trace events: `LIFECYCLE_HEALTHY_SKIP_RECOVERY`, `BFCACHE_HEALTHY_SKIP_RECOVERY` via `logPlaybackEvent` when trace enabled
- [x] Always-on client log: `logPlayback("LIFECYCLE_HEALTHY_SKIP_RECOVERY" | "BFCACHE_HEALTHY_SKIP_RECOVERY", …)`

## Manual verification (iOS Safari)

1. Play entitled track → background app → return within ~2s while audio still audible → no recovery storm; trace shows skip (A).
2. Play → background until audio stalls → return → recovery runs (B).
3. Play → background with Web Audio suspended and no gesture → `gesture_unlock_required` recovery (C).
4. Pause → background → return → no recovery; media session re-sync only (D).
5. Play → navigate away with bfcache → back while still healthy → skip (E).
6. Play → bfcache restore while stalled → recovery (F).
