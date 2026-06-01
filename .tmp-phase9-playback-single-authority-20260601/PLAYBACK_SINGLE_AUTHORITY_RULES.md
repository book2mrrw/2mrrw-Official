# Playback Single Authority Rules — Phase 9

## Rule

**Only `dispatchPlaybackCommand` may mutate playback state** (queue, play/pause, seek, stream upgrade, viewport pause/resume).

Public wrappers (`playTrack`, `playQueue`, `pause`, `resume`, `setQueue`, …) are thin facades that enqueue commands. Internal `*Internal` executors run solely inside `executePlaybackCommand` when `commandExecutionDepthRef > 0`.

## Allowed callers

| Caller | Pattern |
|--------|---------|
| User UI (click/tap) | `dispatchPlaybackCommand` or public wrappers from **event handlers** |
| `AudioContext` listeners | `dispatchPlaybackCommandRef` / `dispatchPlaybackCommand` for recover, viewport, entitlements |
| `AudioPhase10Bridge` | `dispatchPlaybackCommand('setQueue', …)` on `2mrrw:playback-recovery` **event** (not React deps) |

## Forbidden

- `AuthContext` / account refresh calling `pause`, `setQueue`, `playTrack`, `upgradeToFullStream`
- `useEffect` depending on catalog/entitlement/route state that calls playback APIs
- Direct calls to `*Internal` from outside `AudioContext`
- `stream-client.js` issuing playback commands (logging/callbacks only)

## Observability (soft enforcement)

When trace is enabled (`NODE_ENV=development` or `NEXT_PUBLIC_PLAYBACK_TRACE=1`):

- `[PLAYBACK-AUTH-VIOLATION]` — `{ fn, module, action, reason, stack }`
- `[PLAYBACK-SOURCE-TRACE]` — paired structured source line

Logged at entry to: `pauseInternal`, `resumeInternal`, `setQueueInternal`, `playQueueInternal`, `playTrackInternal`, `upgradeToFullStream`, `seekInternal` when `commandExecutionDepthRef === 0`.

## Non-goals (Phase 9)

- No runtime blocking of violations
- No viewport / entitlement / audio timing behavior changes
- No `page.js` bulk migration (see SAFE_MIGRATION_PLAN P2)
