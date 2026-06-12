# Phase 21C — Playback Continuity Layer

## Goal (one-liner)
Make playback feel continuous across iOS lock/unlock by freezing playback UI on **OS_SUSPENDED (class C)**, then reconciling back to live state only after audio + UI intention match again.

## Non-goals / strict boundaries
- No WebKit/WebAudio routing changes.
- No changes to Phase 21B lifecycle truth / recovery gates.
- Only UX + orchestration wiring (UI/chrome display), not transport mechanics.

## Stack mapping
OS → AudioContext/element → 21B truth model → **21C continuity layer** → UI/chrome

## Implementation summary

### 1) `src/context/AudioContext.js`

#### Continuity snapshot (captured once per class C entry)
When lifecycle truth transitions **into** `OS_SUSPENDED`, Phase 21C captures a single snapshot:

```ts
{
  trackId,                    // current track identity
  playbackPosition,          // paused-time (element currentTime)
  queueIndex,                // current queueIndexRef.current
  isPlaying,                 // user-intent snapshot (playbackIntentBeforeHideRef.current)
  cover: { base, baseArtType, cs, csArtType }, // cover metadata refs
  timestamp
}
```

Key rules:
- Snapshot capture happens only on the first class C entry (`C`), and is **not overwritten** during subsequent suspend computations.
- Progress display is frozen by immediately copying the snapshot’s `{ currentTime, duration }` into `progressSnapshotRef`.

#### Freeze gate + progress lock
While the UI freeze is active:
- `notifyProgressListeners()` becomes a no-op (unless forced).
- Progress-duration reconciliation is skipped, keeping the mini scrubs stable during lock/unlock perception gaps.

#### Release + UI reconciliation
Freeze is released only when:
- audio element exists and is **not paused/ended**, and
- transport health is intact, and
- `stateRef.current.isPlaying` matches snapshot `isPlaying`.

On release:
- progress snapshot is updated to live values,
- UI transitions back to live state,
- snapshot refs are cleared.

#### Context surface for UI
`AudioContext` now exposes to consumers:
- `continuityFrozen`
- `getContinuitySnapshot()`

### 2) Minimal UI changes

#### `src/components/storefront/PlaybackChromeIsland.js`
- When `continuityFrozen === true`, the “nowPlaying” state update effect is skipped.
- A dedicated freeze effect sets `nowPlaying` from the snapshot once.
- Mini-player “playing” icon uses `snapshot.isPlaying` (prevents paused→playing flash).
- Ambient background uses snapshot cover metadata to prevent cover/art churn.

#### `src/components/audio/GlobalAudioPlayerBar.js`
- Dock display values (time/duration, play intent, cover inputs) are overridden from the snapshot while frozen.
- The dock scrub percent and play-ring state therefore remain stable through iOS OS_SUSPENDED.

### 3) `src/lib/diagnostics/playback-trace.js` (NEXT_PUBLIC_PLAYBACK_TRACE=1)
New Phase 21C trace events:
- `PLAYBACK_CONTINUITY_SNAPSHOT_CAPTURED`
- `PLAYBACK_CONTINUITY_RESTORED`
- `UI_CONTINUITY_FREEZE_ENTERED`
- `UI_CONTINUITY_RECONCILED`

These are log-only diagnostics and never alter transport behavior.

## Why this fixes the perception gap
Phase 21B intentionally clears React `isPlaying` during OS suspend (while Media Session is preserved). That is correct truth enforcement, but it creates a UI perception gap.

Phase 21C freezes UI display inputs (play intent + cover + progress) on class C so the user sees a continuous “playing” presentation until audio and UI intention converge again.

## 21B gates preserved confirmation
- Phase 21B’s lifecycle truth computation, recovery suppression, watchdog skipping, and Media Session behavior remain unchanged.
- Phase 21C is implemented as a UI-facing continuity overlay on top of the existing truth model.

