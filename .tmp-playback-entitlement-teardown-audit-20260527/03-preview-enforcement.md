# Phase 3 — Preview / Entitlement Enforcement

## Preview duration cap

**Constant:** `PREVIEW_HARD_CAP_SEC = 30` (`AudioContext.js:57`)

### timeupdate enforcement (active fade + stop)

**File:** `src/context/AudioContext.js:640-667`

```640:667:src/context/AudioContext.js
    const onTime = () => {
      persistPlayback("progress");
      syncPositionState(false);

      const track = stateRef.current.currentTrack;
      const previewOnly = track?.metadata?.access?.previewOnly;

      if (previewOnly && audio.currentTime >= PREVIEW_HARD_CAP_SEC - 2) {
        const fadeStart = PREVIEW_HARD_CAP_SEC - 2;
        const elapsed = audio.currentTime - fadeStart;
        const fadeProgress = Math.min(1, elapsed / 2);
        audio.volume = Math.max(0, 1 - fadeProgress);

        if (audio.currentTime >= PREVIEW_HARD_CAP_SEC) {
          skipPauseInterruptionRef.current = true;
          audio.pause();
          audio.volume = 1;
          audio.currentTime = PREVIEW_HARD_CAP_SEC;
          patchState({
            isPlaying: false,
            currentTime: PREVIEW_HARD_CAP_SEC,
            playbackState: "ended_preview",
          });
          setPreviewEnded(true);
          onPreviewEndedRef.current?.(track);
          dispatchPreviewEnded(track.slug);
        }
        return;
      }
```

**Behavior:** At 28s starts fade; at 30s pauses and sets `currentTime = 30` (not full track duration). UI shows `ended_preview`.

**Mismatch with reported symptom:** User reports stop at **1–2s**, not 30s. Preview cap alone does **not** explain the bug unless `previewOnly` is incorrectly set on a **very short** preview asset.

### ended handler (preview branch)

**File:** `src/context/AudioContext.js:690-702`

```690:702:src/context/AudioContext.js
    const onEnded = () => {
      const track = stateRef.current.currentTrack;
      const previewOnly = track?.metadata?.access?.previewOnly;

      if (previewOnly) {
        stopProgressRaf();
        stopPositionSaveTimer();
        patchState({ isPlaying: false, currentTime: PREVIEW_HARD_CAP_SEC, playbackState: "ended_preview" });
        setPreviewEnded(true);
        // ...
        return;
      }
```

If native `ended` fires early (short preview file), state still sets `currentTime` to **30**, not track duration — scrubber may **jump** from ~2s playback to 30s cap display.

### Seek cap

**File:** `src/context/AudioContext.js:1699-1703`

```1699:1703:src/context/AudioContext.js
    if (track?.metadata?.access?.previewOnly) {
      capped = Math.min(time, PREVIEW_HARD_CAP_SEC);
    }
    audio.currentTime = Math.max(0, Math.min(capped, isFinite(audio.duration) ? audio.duration : capped));
```

### UI scrub cap (player bar)

**File:** `src/components/audio/GlobalAudioPlayerBar.js:17-18, 523-534`

- `PREVIEW_MAX_SEC = 30`, `PREVIEW_SCRUB_CAP_RATIO = 0.3`
- Display cap: `min(30, duration * 0.3)`

## Guest restrictions

| Layer | Behavior |
|-------|----------|
| `resolveTrackAccess` | Default `previewOnly: true`, `canStream: false` without owned/subscriber/collector |
| `resolvePlaybackSrc` | Public R2 preview CDN |
| `library/stream` GET | Requires user (`getFanSessionUser` or `getGuestUser`); 401 if none |
| `userCanStreamProduct` | Requires membership or collector (server) |

Guests with guest cookie can hit `/api/library/stream` but fail `userCanStreamProduct` → 403 unless entitled server-side.

## Auth state transitions during play

### Entitlement upgrade (preview → full)

**File:** `src/context/AudioContext.js:1399-1408`

```1399:1408:src/context/AudioContext.js
  useEffect(() => {
    const onEntitlementsUpdated = () => {
      const track = stateRef.current.currentTrack;
      const meta = track?.metadata?.access;
      if (meta?.previewOnly && stateRef.current.isPlaying) {
        void upgradeToFullStream();
      }
    };
    window.addEventListener("entitlements:updated", onEntitlementsUpdated);
```

Dispatched from checkout success (`page.js:1260`, `success/page.js:111`). **Upgrades** playback; does not terminate.

### 401 stream → preview fallback (entitled metadata)

**File:** `src/context/AudioContext.js:1074-1100`

When `metadata.access.canStream` is true but stream returns 401, falls back to preview and **mutates** track metadata:

```1091:1096:src/context/AudioContext.js
                access: {
                  ...(nextTrack.metadata?.access || {}),
                  previewOnly: true,
                },
```

After fallback, preview cap applies at 30s — still not 1–2s unless asset is short.

### Release card 2s upgrade timer

**File:** `src/components/music/ReleaseCardPlayButton.js:58-62`

```58:62:src/components/music/ReleaseCardPlayButton.js
      void playQueue([track], 0);
      if (track.metadata?.access?.canStream) {
        upgradeTimerRef.current = setTimeout(() => {
          void upgradeToFullStream();
        }, 2000);
      }
```

**Critical timing alignment:** Scheduled **2 seconds** after play for entitled users. Calls `upgradeToFullStream()` which reloads `audio.src` via `waitAudioSrcReady` (`AudioContext.js:1360-1371`).

## Does verification failure set currentTime to duration or trigger `ended`?

| Failure mode | Sets currentTime to duration? | Triggers ended? |
|--------------|------------------------------|-----------------|
| Preview 30s cap | Sets to **30**, not duration | pause + manual state |
| Native ended (full track) | Browser sets to duration | yes → `onEnded` |
| ACCESS_DENIED | No seek | pause only |
| 401 preview fallback | No seek to duration | continues on preview |
| Saved resume near end | **Yes** — seeks to saved position (`playTrack` resumeAt) | often immediate `ended` |
| upgradeToFullStream src swap | Seeks to `resumeAt` (~2s) | reload may fire `ended` if bad asset |

## Client vs server entitlement mismatch

| Check | Client (`resolveTrackAccess`) | Server (`userCanStreamProduct`) |
|-------|--------------------------------|----------------------------------|
| Subscription | Needs `subscriberActive && permissions.subscriber` | `membershipHasPremiumAccess` only |
| Owned | permanent slugs + library purchases | `userOwnsProduct` |
| Collector | card owner or active ownership rows | `getCollectorAccessState` |

Server can allow stream when client still shows preview → background `swapToSignedStream` upgrades mid-play.

Client can show `canStream` when server denies (stale session) → redirect/onError → 401 fallback or ACCESS_DENIED pause.
