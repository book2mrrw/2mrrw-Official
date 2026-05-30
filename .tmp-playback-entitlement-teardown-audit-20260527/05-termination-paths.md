# Phase 5 — Termination Paths (AudioContext grep)

## Summary table

| Mechanism | File:line | Symptom | Jump to end? |
|-----------|-----------|---------|--------------|
| Preview 30s cap (timeupdate) | `AudioContext.js:647-666` | pause @ 30s, `ended_preview` | Sets currentTime=30 |
| Preview ended handler | `AudioContext.js:694-701` | `ended_preview` | Sets currentTime=30 |
| Full track ended | `AudioContext.js:690-775` | `ending` → idle / next | currentTime→0 or queue advance |
| ACCESS_DENIED | `AudioContext.js:866-876`, `1103-1117` | pause, accessDenied | No |
| Stream error (final) | `AudioContext.js:887-892` | pause, retryable error | No |
| 401 preview fallback | `AudioContext.js:837-863` | continues on preview | No immediate jump |
| stop() | `AudioContext.js:1734-1764` | full reset | currentTime→0 |
| upgradeToFullStream | `AudioContext.js:1340-1396` | src reload | Seek to resumeAt; may trigger ended |
| swapToSignedStream | `AudioContext.js:1143-1172` | src reload mid-play | Seek to resumeAt |
| Deferred resume seek | `AudioContext.js:1180-1292` | seek after metadata | **Yes — near end if saved** |
| Release card 2s timer | `ReleaseCardPlayButton.js:59-62` | triggers upgrade | Reload ~2s |
| Device change | `AudioContext.js:914-920` | pause | No |

## pause() call sites

```
AudioContext.js:655  — preview cap
AudioContext.js:869  — ACCESS_DENIED on error retry
AudioContext.js:919  — no audio output device
AudioContext.js:1107 — ACCESS_DENIED on playTrack resolve
AudioContext.js:1268 — track change (not same track)
AudioContext.js:1459 — CS mode src swap
AudioContext.js:1502 — CS toggle src swap
AudioContext.js:1620 — pause()
AudioContext.js:1749 — stop()
AudioContext.js:1935 — beginCsHoldPreview
AudioContext.js:1983 — endCsHoldPreview restore
```

## currentTime = assignments

| Line | Context |
|------|---------|
| 657 | Preview cap → 30 |
| 731 | Repeat-one → 0 |
| 820 | Error retry seek |
| 966 | CS apply seek |
| 1151 | swapToSignedStream seek |
| 1277 | Same-track resume |
| 1286 | pendingSeekRef apply |
| 1366 | upgradeToFullStream seek |
| 1572 | (context: reset path) |
| 1657 | resume() URL refresh seek |
| 1703 | seek() user scrub |
| 1719 | seekBack |
| 1729 | seekForward |
| 1941 | CS hold preview seek |
| 1988 | end CS hold seek |
| 1995 | restore after CS hold |

## ended / preview listeners

**Registration:** `AudioContext.js:901-904`

```901:904:src/context/AudioContext.js
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("ended", onEnded);
```

### onEnded (full track path)

```723:775:src/context/AudioContext.js
      patchState({ playbackState: "ending" });

      const finishEnded = () => {
        if (repeatMode === "one" && stateRef.current.currentTrack) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
          return;
        }
        // queue advance or idle
        patchState({ isPlaying: false, currentTime: 0, playbackState: "idle" });
        // ...
      };

      setTimeout(finishEnded, 2000);
```

**Note:** 2s delay before UI resets after native ended — user may see scrubber at end for 2s before idle.

## timeupdate-driven termination

Only preview cap in `onTime` (lines 647-666). No entitlement check in timeupdate.

Progress persistence throttled to 15s (`AudioContext.js:551-553`):

```551:553:src/context/AudioContext.js
        if (eventType === "progress" && lastPersistRef.current.key === track.slug && now - lastPersistRef.current.at < 15000) {
          return prev;
        }
```

Play event fires immediately on `onPlay` (line 595) — coincides with first `/api/playback/events` failure in Network tab.

## src swap / abort paths

**waitAudioSrcReady** (`AudioContext.js:59-78`):

```59:78:src/context/AudioContext.js
async function waitAudioSrcReady(audio, src) {
  audio.src = src;
  await new Promise((resolve) => {
    // canplay / error / 3s timeout
    audio.load();
  });
}
```

Assigning new `src` while playing aborts current decode → can fire `pause`, `emptied`, `error`, or `ended` depending on browser.

**onEmptied** (`AudioContext.js:894-897`):

```894:897:src/context/AudioContext.js
    const onEmptied = () => {
      stopProgressRaf();
      patchState({ currentTime: 0, duration: 0 });
    };
```

Src swap may briefly zero timeline before new metadata loads.

## Deferred resume (jump-to-end mechanism)

**File:** `src/context/AudioContext.js:1180-1195`

```1180:1195:src/context/AudioContext.js
    let resumeAt = options.resumeAt && options.resumeAt > 5 ? options.resumeAt : null;
    if (!resumeAt && userId && streamSlug) {
      const saved = getSavedPlaybackPosition(userId, streamSlug);
      if (saved?.positionSeconds > 5) {
        resumeAt = saved.positionSeconds;
      }
    }
    if (!resumeAt && accountState?.mediaProgress?.length) {
      const savedProgress = accountState.mediaProgress.find(
        (p) => p.product_slug === nextTrack.slug && !p.completed
      );
      if (savedProgress?.position_seconds > 5) {
        resumeAt = savedProgress.position_seconds;
      }
    }
```

Applied via `pendingSeekRef` after load (`1283-1291`):

```1283:1291:src/context/AudioContext.js
      if (pendingSeekRef.current) {
        const applyPendingSeek = () => {
          if (pendingSeekRef.current && isFinite(audio.duration)) {
            audio.currentTime = Math.min(pendingSeekRef.current, Math.max(0, audio.duration - 1));
          }
          pendingSeekRef.current = null;
          audio.removeEventListener("loadedmetadata", applyPendingSeek);
        };
        audio.addEventListener("loadedmetadata", applyPendingSeek);
      }
```

**Timeline:** Audio starts at 0 → plays 1–2s until metadata → seek to near `duration-1` → immediate or quick `ended`.

## playbackState values

| Value | Meaning |
|-------|---------|
| `null` | Normal / unset at play start |
| `playing` | Active |
| `paused` | User or error pause |
| `ended_preview` | Preview cap or preview ended |
| `ending` | Full track ended, pre-idle delay |
| `idle` | Stopped at end |
| `preview_fallback` | 401 downgrade to preview |

## Exact termination trigger (most likely for 1–2s symptom)

**Primary:** Native `HTMLMediaElement` `ended` event → `onEnded` handler, preceded by deferred `currentTime` seek to saved position near track end.

**Secondary:** Native `ended` after `upgradeToFullStream` / `swapToSignedStream` reloads a truncated or wrong asset ~2s after `ReleaseCardPlayButton` timer.

**Not termination:** `/api/playback/events` 404 — no code path connects failure to audio teardown.
