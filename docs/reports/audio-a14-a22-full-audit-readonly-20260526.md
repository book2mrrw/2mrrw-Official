# Audio Audit A14-A22 (Read-Only)

Date: 2026-05-26  
Repo: `/Users/recharge/artist-platform`  
Audit mode: Read-only (no source modifications)

## Scope
This audit covers sections **A14 through A22** with exact code evidence, search outcomes, and per-item statuses.

---

## A14 BACKGROUND AUDIO AND MEDIA SESSION

### Evidence (files requested)
- `src/context/AudioContext.js`
- `src/app/layout.js`

`src/app/layout.js`: no `navigator.mediaSession` references.

`src/context/AudioContext.js` media session references (all found):
- `navigator.mediaSession?.setPositionState`
- `navigator.mediaSession.setPositionState(...)`
- `const ms = navigator.mediaSession`
- `ms.metadata = new MediaMetadata({...})`
- `navigator.mediaSession.playbackState = "paused"`
- cleanup/reset: `navigator.mediaSession.metadata = null`, `navigator.mediaSession.playbackState = "none"`
- action handlers: `ms.setActionHandler("play"|"pause"|"previoustrack"|"nexttrack"|"seekto", ...)`

MediaMetadata fields present:
- `title`, `artist`, `album`, `artwork` in `updateMediaSession`.

Action handlers present:
- `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`.

Action handlers missing from this section’s requested set:
- none (for A14 request list).

Audio element attrs in provider:
- `<audio ... playsInline ... />` present.
- `webkit-playsinline` not present on the `<audio>` element.

Web Audio API `AudioContext` separate from HTML audio:
- No usage of `new AudioContext(...)` / `window.AudioContext` / `webkitAudioContext` in `src/context/AudioContext.js`.
- No `resume()` on first gesture flow found.

`visibilitychange` / hidden handling:
- `document.addEventListener("visibilitychange", onVisibility)` present.
- On hidden, code explicitly pauses audio:
  - `audio.pause();`
  - `patchState({ isPlaying: false });`

`pagehide` / `beforeunload`:
- `beforeunload` handler exists and persists session state.
- `pagehide` handler not found.

### A14 Status
- mediaSession metadata: **IMPLEMENTED**
- mediaSession action handlers (`play/pause/previoustrack/nexttrack/seekto`): **IMPLEMENTED**
- playsinline attr on audio: **PARTIAL** (has `playsInline`, missing `webkit-playsinline` on audio element)
- No visibilitychange pause handler blocking background: **MISSING** (handler exists and pauses on hidden)
- AudioContext resume on first gesture: **MISSING**

---

## A15 MOBILE SPECIFIC BEHAVIORS

### 1) PreviewPlayerControls scrub touch handlers vs click/mousedown
File: `src/components/preview/immersive/PreviewPlayerControls.js`
- Scrub handler definition:
  - `const seekTo = useCallback((e) => { ... const ratio = ... (e.clientX - rect.left) ...; seek(ratio * maxSeek); }, ...)`
- Binding:
  - `onClick={seekTo}` on progress rail.
- Missing:
  - No `onTouchStart`, `onTouchMove`, `onTouchEnd`, `onMouseDown`, `onPointerDown` in this component.

Status: **PARTIAL** (click-only; no explicit touch/mousedown scrub handlers).

### 2) `touch-action: manipulation` on play button (globals.css + inline)
Findings:
- `src/app/globals.css` has `touch-action: manipulation` on `.modal-immersive-panel--scroll` and `.gift-reveal-root` (not specific to PreviewPlayerControls play button).
- `src/components/audio/GlobalAudioPlayerBar.js` has inline `touchAction: "manipulation"` on cover frame style.
- No explicit `touch-action: manipulation` found on the PreviewPlayerControls play button itself (`SignaturePlayRing` usage here).

Status: **PARTIAL**.

### 3) pause event handling in AudioContext; user vs system pause
File: `src/context/AudioContext.js`
- Distinguishes pause source using:
  - `const userInitiated = userPausedRef.current;`
  - `if (!userInitiated && track && audio.paused) { /* External audio interruption ... */ }`

Status: **IMPLEMENTED** (source distinction exists; external branch is comment-only logic).

### 4) Search `mediadevices/devicechange/ondevicechange/headphone`
Search across `src` found:
- No matches for `mediadevices`, `mediaDevices`, `devicechange`, `ondevicechange`, `headphone`.

Status: **MISSING**.

### 5) network interruption events: `stalled/suspend/waiting/error` and retry
File: `src/context/AudioContext.js`
- Event listeners present:
  - `waiting`, `stalled`, `error`, `canplaythrough`.
- Retry path:
  - `onError` attempts `fetchLibraryStream(...)`, swaps `audio.src`, `audio.load()`, then `await audio.play()`.
  - explicit retry API path via `retryStreamPlayback`.
- `suspend` event listener: not found.

Status: **PARTIAL**.

### 6) double tap prevention in ReleaseCardPlayButton + PreviewPlayerControls
- `src/components/music/ReleaseCardPlayButton.js`: no double-tap prevention logic.
- `src/components/preview/immersive/PreviewPlayerControls.js`: no double-tap prevention logic.
- Note: double-tap behavior exists elsewhere (`GlobalAudioPlayerBar` cover gesture), but not in requested files.

Status: **MISSING**.

### 7) GPU accel: will-change + transform/opacity vs top/left/width/height in globals.css + ImmersiveModalScene.js
- `src/app/globals.css` includes `will-change: opacity`, `will-change: transform`, and transform-heavy animation usage in immersive layers.
- `src/components/preview/immersive/ImmersiveModalScene.js` is structural markup only; no direct style logic there.

Status: **IMPLEMENTED** (GPU-oriented CSS patterns present in globals for immersive scene classes).

### 8) minimum tap target sizes in ModalActionButtons + PreviewPlayerControls (exact px)
- `src/components/preview/immersive/ModalActionButtons.js`:
  - `.modal-immersive-action-card` min-height is `48px` (in `globals.css`).
  - `.modal-immersive-act-btn` uses `padding: 6px` only; no fixed min width/height.
- `src/components/preview/immersive/PreviewPlayerControls.js`:
  - play button size passed as `size={playSize}` where `playSize = compact ? 52 : 60`.
  - scrub rail clickable, but no larger explicit touch target height beyond rail CSS.

Status: **PARTIAL**.

### 9) iPhone SE 375px handling in globals.css
- No explicit `375px`, `max-width: 375`, or iPhone SE-specific rule in `src/app/globals.css`.

Status: **MISSING**.

### 10) visibilitychange handlers across src
Files found:
- `src/context/AudioContext.js` (audio pause/resume + media session rehydrate)
- `src/hooks/sync/useSyncEngine.js` (resync on visible)
- `src/app/page.js` (pauses carousel videos when hidden)

Status: **IMPLEMENTED**.

---

## A16 SILENT FAILURE DETECTION

Target: `AudioContext.js` after `audio.play()` detect if `currentTime` advances.

Findings:
- No post-`audio.play()` watchdog that verifies `currentTime` progression.
- `currentTime` is read for progress/state updates, seeking, telemetry, and persistence.
- Stall indicators exist (`waiting`/`stalled` set buffering), but no explicit “play started but clock stuck” recovery loop.

Stall code found:
- `const onWaiting = () => patchState({ isBuffering: true });`
- `const onStalled = () => patchState({ isBuffering: true });`
- listeners: `audio.addEventListener("waiting", onWaiting);` and `audio.addEventListener("stalled", onStalled);`

Status: **PARTIAL**.

---

## A17 NOTIFICATION/SYSTEM INTERRUPTION RECOVERY

File: `src/context/AudioContext.js`

Pause handler (exact logic) distinguishes user vs system via `userPausedRef` and comments on external interruption, but does not auto-resume from pause event itself.

Auto-resume behavior exists on `visibilitychange` return path when `wasPlayingBeforeHideRef.current` is true; this is page visibility-driven, not generic interruption recovery.

Status: **PARTIAL**.

---

## A18 BLUETOOTH AND AUDIO OUTPUT CHANGES

Search terms: `audiooutputdevicechange`, `sinkId`, `setSinkId`, `ondevicechange`, `mediaDevices`

Results across `src`:
- No matches.

Status: **MISSING**.

---

## A19 PROGRESS BAR SYNC TO REAL AUDIO STATE

Files: `src/components/preview/immersive/PreviewPlayerControls.js`, `src/context/AudioContext.js`

Findings:
- Preview scrub UI derives progress from `currentTime` and `duration` from media engine state:
  - `progress = ... (currentTime / displayDuration) * 100`
- In `AudioContext`, `currentTime` is driven by real `<audio>` element:
  - `timeupdate` handler (`onTime`) + `syncPositionState(...)`
  - RAF loop (`startProgressRaf`) repeatedly reads `audio.currentTime` while playing and patches state.

Mechanism type:
- **Real audio element-driven** (`audio.currentTime`), with both event-driven and RAF smoothing.

Status: **IMPLEMENTED**.

---

## A20 APP RETURN STATE SYNC

Search: `visibilitychange` across `src`

Visibility handlers copied:
- `src/context/AudioContext.js`: `onVisibility` handles hidden/visible, saves position, pauses on hide, optionally resumes on return, refreshes stream URL if stale, and rehydrates media session.
- `src/hooks/sync/useSyncEngine.js`: visible-state resync (`guardedResync("visibility")`).
- `src/app/page.js`: pauses/resumes carousel videos.

UI/audio state sync on return:
- For the main audio engine, state sync is handled on visible re-entry and optional resume via `wasPlayingBeforeHideRef.current` plus media session rehydrate.

Status: **IMPLEMENTED**.

---

## A21 MEDIA SESSION AND BLUETOOTH

### Sub-item findings
1. mediaSession.metadata set with `title/artist/album/artwork`  
   Status: **IMPLEMENTED** (`updateMediaSession` in `AudioContext.js`).

2. Artwork URL format + static image or MP4 + sizes array values  
   Status: **IMPLEMENTED** (for media session artwork):
   - Artwork built in `src/lib/media-session-artwork.js` from absolute URL via `resolveAbsoluteArtworkUrl`.
   - Sizes array values: `96x96`, `128x128`, `256x256`, `512x512`.
   - Media Session artwork entries are image MIME-based (`image/jpeg|png|webp`), not MP4.

3. Handlers set: `play`, `pause`, `stop`, `previoustrack`, `nexttrack`, `seekbackward`, `seekforward`, `seekto`  
   Status: **PARTIAL**:
   - Implemented: `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`
   - Missing: `stop`, `seekbackward`, `seekforward`

4. Audio element attrs: `playsinline`, `webkit-playsinline`, `x-webkit-airplay="allow"`  
   Status: **PARTIAL**:
   - `<audio>` in `AudioContext`: `playsInline` present.
   - `webkit-playsinline` absent on `<audio>`.
   - `x-webkit-airplay="allow"` absent.

5. Output device reroute handling (`setSinkId/sinkId/audiooutput`)  
   Status: **MISSING** (no matches across `src`).

6. On track change, metadata update timing  
   Status: **IMPLEMENTED**:
   - Metadata update called immediately in `playTrack` after `audio.play()` invocation (`void updateMediaSession(...)`).
   - Updated again on `play`/`pause` events.

7. Cover art URL format and R2 CDN usage; dimensions/multi-size  
   Status: **IMPLEMENTED**:
   - URL resolution supports absolute URLs and `NEXT_PUBLIC_R2_PUBLIC_URL` base.
   - Media Session entries provide multiple sizes (`96/128/256/512`), not single-size.

8. Search terms in src: `AirPlay`, `airplay`, `x-webkit-airplay`  
   Status: **MISSING** (no containing files found).

---

## A22 CS MODE — CHOPPED AND SCREWED

Search terms run: `csMode, cs_mode, csAudio, applyCSMode, applyCSToElement, CSModeButton, choppedSlowed, playbackRate, csAudio`.

### 1) CS mode implemented in AudioContext (toggle logic)
- `toggleCSMode` implemented in `src/context/AudioContext.js`:
  - flips mode
  - resolves presentation
  - may swap src
  - applies playback params
  - patches state + updates media session

Status: **IMPLEMENTED**.

### 2) Whether it swaps URL and/or playbackRate
- Both supported:
  - If `track.csAudio` exists, swaps `src` to CS source and keeps rate `1`.
  - If no CS source, keeps base src and sets `playbackRate` to `0.75`.

Status: **IMPLEMENTED**.

### 3) Separate CS audio URL field name in catalog data
- Supported fields:
  - `csAudio` and `cs_audio` (normalized in `AudioContext` and `toPlaybackTrack`).

Status: **IMPLEMENTED**.

### 4) CS cover art URL field name
- Supported fields:
  - `csCover`, `cs_cover`, `csCoverArt`.

Status: **IMPLEMENTED**.

### 5) CS toggle button in ReleaseCardPlayButton + PreviewPlayerControls (what it looks like)
- `ReleaseCardPlayButton.js`: no CS toggle button.
- `PreviewPlayerControls.js`: no CS toggle button.
- CS toggle UI exists elsewhere (`CSModeButton`, `ChoppedSlowedToggle`).

Status: **MISSING** (for requested components).

### 6) CS button in ImmersivePreviewModal / immersive components
- No CS button found in preview immersive modal components.
- CS button exists in global player immersive engine:
  - `CompactDockPlayer` and `FloatingMainPlayer` include `<CSModeButton />`.

Status: **PARTIAL**.

### 7) Cover art change when CS mode active
- Implemented in playback presentation + player rendering:
  - CS mode can switch to `csCover`.
  - Global player uses CS cover when active.

Status: **IMPLEMENTED**.

### 8) GlobalAudioPlayerBar shows CS mode state
- Yes; consumes `csMode`, toggles visuals/cover behavior, and supports CS gestures + toggle.

Status: **IMPLEMENTED**.

### 9) CS mode reflected in mediaSession metadata
- Metadata uses current track object (`title`, `cover`, etc.), and CS toggle updates current track + calls `updateMediaSession(nextTrack, ...)`.

Status: **IMPLEMENTED**.

### 10) `page.js` catalog track fields for csAudio/cs_audio/slowed URLs
- In `src/app/page.js` local catalog constants, no `csAudio`/`cs_audio` fields found.
- CS fields are consumed in shared mapping/access layers (`music-playback`, control-system release merge paths), but not present in the static inline catalog constants in `page.js`.

Status: **MISSING** (in `page.js` inline catalog declarations).

---

## Key Exact Snippets (requested handlers)

### AudioContext pause handler (A17)
From `src/context/AudioContext.js`:

```js
const onPause = () => {
  const userInitiated = userPausedRef.current;
  userPausedRef.current = false;

  if (skipPauseInterruptionRef.current) {
    skipPauseInterruptionRef.current = false;
    return;
  }

  stopProgressRaf();
  stopPositionSaveTimer();
  patchState({ isPlaying: false });
  persistPlayback("pause");

  const track = stateRef.current.currentTrack;
  if (track) {
    void updateMediaSession(track, { playing: false });
  } else if (typeof navigator !== "undefined" && navigator.mediaSession) {
    navigator.mediaSession.playbackState = "paused";
  }

  if (!userInitiated && track && audio.paused) {
    /* External audio interruption — metadata retained, state paused */
  }
};
```

### Media session action handler setup (A14/A21)
From `src/context/AudioContext.js`:

```js
const handlePlay = () => {
  void resume();
};
const handlePause = () => {
  pause();
};
const handleNext = () => {
  void playNext();
};
const handlePrev = () => {
  void playPrevious();
};
const handleSeek = (details) => {
  if (details?.seekTime != null && Number.isFinite(details.seekTime)) {
    seek(details.seekTime);
  }
};
try {
  ms.setActionHandler("play", handlePlay);
  ms.setActionHandler("pause", handlePause);
  ms.setActionHandler("previoustrack", handlePrev);
  ms.setActionHandler("nexttrack", handleNext);
  ms.setActionHandler("seekto", handleSeek);
} catch {
  /* action handler not supported */
}
```

### PreviewPlayerControls scrub and play handlers (A15)
From `src/components/preview/immersive/PreviewPlayerControls.js`:

```js
const seekTo = useCallback(
  (e) => {
    if (!displayDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const maxSeek = previewOnly ? PREVIEW_DISPLAY_CAP_SEC : displayDuration;
    seek(ratio * maxSeek);
  },
  [displayDuration, previewOnly, seek]
);

const togglePlay = useCallback(
  (e) => {
    e?.stopPropagation?.();
    if (streamRetryable && error) {
      void retryStreamPlayback();
      return;
    }
    toggle();
  },
  [error, toggle, retryStreamPlayback, streamRetryable]
);
```

### CS toggle logic (A22)
From `src/context/AudioContext.js` (core body):

```js
const toggleCSMode = useCallback(async () => {
  const next = !csModeRef.current;
  csModeRef.current = next;

  const audio = audioRef.current;
  const track = stateRef.current.currentTrack;
  if (!audio || !track || !stateRef.current.hasStarted) {
    patchState({ csMode: next, csTrack: next && track ? normalizeTrack(track) : null });
    return next;
  }

  const normalized = stateRef.current.csTrack || normalizeTrack(track);
  const resumeAt = audio.currentTime;
  const presentation = resolvePlaybackPresentation(normalized, next, csUsingAlternateSrcRef.current);
  const nextTrack = {
    ...normalized,
    title: presentation.title,
    src: presentation.src,
    cover: presentation.cover,
  };

  const currentUrl = audio.currentSrc || audio.src;
  const targetUrl = new URL(nextTrack.src, window.location.href).href;
  const needsSrcSwap = currentUrl !== targetUrl;

  try {
    if (needsSrcSwap) {
      skipPauseInterruptionRef.current = true;
      audio.pause();
      audio.src = nextTrack.src;
      audio.load();
      pendingSeekRef.current = resumeAt > 0 ? resumeAt : null;
    }
    applyCsToElement(audio, presentation, resumeAt > 0 ? resumeAt : null);
    patchState({
      csMode: next,
      csTrack: next ? normalized : null,
      currentTrack: nextTrack,
    });
    void updateMediaSession(nextTrack, { playing: !audio.paused });
    if (audio.paused && stateRef.current.isPlaying) {
      await audio.play();
    }
    syncPositionState(true);
  } catch {
    csModeRef.current = !next;
    patchState({ error: "Could not apply chopped & slowed mode.", csMode: !next });
  }
  return next;
}, [patchState, updateMediaSession, applyCsToElement, syncPositionState]);
```

---

## Consolidated A14-A22 Status Matrix

- **A14**: IMPLEMENTED/PARTIAL/MISSING mix (see section)
- **A15**: IMPLEMENTED/PARTIAL/MISSING mix (see section)
- **A16**: PARTIAL
- **A17**: PARTIAL
- **A18**: MISSING
- **A19**: IMPLEMENTED
- **A20**: IMPLEMENTED
- **A21**: IMPLEMENTED/PARTIAL/MISSING mix (see section)
- **A22**: IMPLEMENTED/PARTIAL/MISSING mix (see section)

