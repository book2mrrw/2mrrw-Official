# Render churn log (Phase 6C)

## Prefix

`[render-churn]`

## Scope

`AudioProvider` only (`src/context/AudioContext.js`).

## Fields

| Field | Meaning |
|-------|---------|
| `renderCount` | Monotonic render counter (dev trace only) |
| `reasonGuess` | `scroll` \| `auth` \| `entitlement` \| `playback` \| `unknown` |
| `changed` | Dep keys that changed vs previous render |
| `deps` | Snapshot: `userId`, `authLoading`, `entitlementUserId`, `isPlaying`, `playbackState`, `currentTrackId`, `queueLen` |

## Reason heuristics

1. **scroll** — `traceContext.lastScrollAt` within 600ms (set from `page.js` scroll).
2. **auth** — `authLoading` or `userId` changed.
3. **entitlement** — `entitlementUserId` changed.
4. **playback** — only playback-related deps changed.
5. **unknown** — other combinations or first mounts.

## Usage

If playback stops without a `pauseInternal` event, check whether `[render-churn]` bursts align with the stop — supports classification **D** (React churn).

Does **not** log every render when deps are unchanged (except first two renders).
