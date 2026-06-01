# Mobile Playback Stability Findings

## iOS / Safari background & lock screen

### AudioContext visibility handler (primary)

```2888:2950:src/context/AudioContext.js
if (document.visibilityState === "hidden") {
  // saves position, may refresh signed stream URL
  wasPlayingBeforeHideRef.current = isPlaying && !audio.paused;
}
if (document.visibilityState === "visible") {
  if (shouldResume && audio?.paused && stateRef.current.isPlaying) {
    if (isLikelyIOS()) {
      patchState({ isPlaying: false, playbackState: "paused" });  // NO auto-resume
    } else {
      void dispatchPlaybackCommand(RECOVER);
    }
  }
}
```

| Observation | Implication |
|-------------|-------------|
| **iOS deliberately does not auto-RECOVER** | After lock screen / app switch, UI shows paused even if user expects resume |
| Hidden: saves position + stream URL refresh | Good for resume-at; async fetch during background |
| `wasPlayingBeforeHideRef` cleared on visible | User must tap play again on iOS |

### page.js visibility (cinematic videos only)

`document.visibilitychange` pauses **carousel `<video>` elements** — **not** global music audio (L994–1006).

### pagehide / beforeunload

| Event | Audio behavior |
|-------|----------------|
| `pagehide` | Saves position; **does not call pause** |
| `beforeunload` | Persists Media Session metadata |

### Media Session API

- `updateMediaSession` / `rehydrateMediaSession` on visible return  
- Action handlers: play, pause, next, prev, seek  
- Lock screen controls depend on metadata + live audio element  

### Keep-alive

20s interval posts to service worker — attempts to reduce iOS suspension; **best-effort**, not guaranteed.

### Single `<audio>` element

```3219:3226:src/context/AudioContext.js
<audio ref={audioRef} preload="auto" playsInline crossOrigin="anonymous" />
```

Not destroyed on auth refresh — **element survival is good**. iOS may still suspend decoded audio process.

## Why playback stops on lock / app switch

| Cause | Evidence | Intentional? |
|-------|----------|--------------|
| OS suspends Web Audio / media | Platform behavior | — |
| iOS visible handler sets paused state | `isLikelyIOS()` branch | **Yes (conservative)** |
| User state `isPlaying` true but element paused | Mismatch until user taps | Byproduct of iOS branch |
| Stream signed URL expires in background | `streamUrlNeedsRefresh` refresh on hide | Mitigation attempt |
| Auth poll on return to app | subscribe/success patterns if user navigates | Incidental re-render |
| Full `window.location` navigation | Guest redirect | **Yes** — stops all media |

## AudioContext.pause on auth?

**No** — `refreshAccountState` does not invoke `pause()` or `stop()`.

## Bluetooth / Dynamic Island

Uses standard Media Session + single element — no second `<audio>` (aligned with BUILD_FRAME_OF_MIND). No dedicated CarPlay bridge found in audit.

## CS hold / preview

`beginCsHoldPreview` pauses main element temporarily — separate from backgrounding.

## Recommendations (report only)

1. Document iOS “tap to resume after unlock” as expected UX unless product wants gated `RECOVER` experiment.  
2. On visible + iOS, optionally sync `isPlaying` from `!audio.paused` once before forcing pause.  
3. Defer `setQueue` recovery until confirming no active playback session.
