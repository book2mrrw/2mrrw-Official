# Audit 4: Media Session + Queue Synchronization

## 1) Confirmed problems
- Media Session metadata/playback state updates are dispatched from several paths (play, pause, visibility, rehydrate, stop), risking out-of-order metadata on fast transitions (`src/context/AudioContext.js`).
- Queue refs (`queueRef`, `queueIndexRef`) and state are both maintained; divergence can occur during async transitions.
- `useMediaEngine` snapshots map context state for UI control, but queue/current track actions still execute through context methods, allowing stale UI assumptions under rapid changes (`src/media/useMediaEngine.js`, `src/components/audio/GlobalAudioPlayerBar.js`).
- `onEnded` queue advance and media session state changes are delayed and may conflict with manual next/prev during the delay window.

## 2) Potential future risks
- Additional remote-control actions (Bluetooth/lock-screen) can increase command collisions.
- Album modal and global bar both issuing control events can create order inversions without command serialization.

## 3) Race conditions
- **RC-8:** mediaSession action handlers (`nexttrack`/`previoustrack`) can interleave with `onEnded` delayed transition.
- **RC-9:** visibility-triggered `rehydrateMediaSession` can overwrite metadata for newly switched track.

## 4) Mobile-specific risks
- Lock-screen controls are common on mobile; inconsistent queue index sync degrades perceived reliability.

## 5) App-transition risks
- Background media metadata may persist stale track if stop/clear path and persisted session data race.

## 6) Hidden architectural divergence
- Playback control is centralized in context, but command origins are distributed (page, modal, global bar, media session actions) without global sequencing.

## 7) Memory leak risks
- Repeated action handler registration is cleaned up, but stale closures can still fire if track changes happen during handler execution.

## 8) Hydration/remount risks
- Rehydrate-from-sessionStorage depends on `hasStarted` and current state checks that can skip legitimate recovery cases.

## 9) Async-flow instability
- `persistMediaSessionTrack` and UI `nowPlaying` state in `page.js` are independently maintained, increasing potential mismatch.

## 10) Exact file-level remediation recommendations
- Implement a command bus with serialized control events (`play`, `pause`, `seek`, `next`, `prev`, `ended`, `visibility_restore`, `media_session_action`):
  - `src/context/AudioContext.js`
  - `src/media/useMediaEngine.js`
  - `src/components/audio/GlobalAudioPlayerBar.js`
  - `src/components/preview/ImmersivePreviewModal.js`
  - `src/app/page.js`
- Derive queue index exclusively from reducer state (remove mutable dual ref authority):
  - `src/context/AudioContext.js`
- Make media session updates edge-triggered from reducer commits, not ad hoc in handlers:
  - `src/context/AudioContext.js`
  - `src/lib/media-session-artwork.js`

## 11) Priority (critical/high/medium/low)
- **Critical:** command serialization + single queue authority.
- **High:** media session update unification and recovery semantics.
- **Medium:** cleanup of duplicate now-playing state ownership in page shell.
- **Low:** metadata caching optimizations.
