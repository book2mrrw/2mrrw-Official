# Render vs Audio Desync Report

**HEAD:** `34df134` | Phase 7

---

## Executive summary

The platform correctly uses **one** music `<audio>` element. Desync is not from duplicate engines but from **parallel UI state** (`page.js` `nowPlaying`), **multiple resume paths** (viewport direct vs command queue vs `onPause` healer), and **high churn** on the home shell re-rendering while audio state lives in a stable provider.

---

## 1. Architecture: one engine, many readers

| Consumer | Reads | Writes transport? |
|----------|-------|-------------------|
| `AudioContext` | `audioRef`, `stateRef` | **Yes** (SOT) |
| `useMediaEngine` | Context + `subscribeMediaEngine` | Via context actions |
| `GlobalAudioPlayerBar` | `useMediaEngine` | toggle/seek |
| `page.js` mini player | `useAudioPlayer` + **`nowPlaying`** | `toggle`, `seek`, `pause`, `dismissNowPlaying` |
| `ImmersivePreviewModal` | `useMediaEngine` | play/pause |
| `AudioPhase10Bridge` | queue, `hasStarted` | `setQueue`, `seek` (recovery only) |

---

## 2. `nowPlaying` shadow state

### Sync in

```1230:1249:src/app/page.js
  useEffect(() => {
    const shouldShowNowPlaying = Boolean(
      currentTrack &&
      !previewModalOpen &&
      !featureModalOpen &&
      !albumModalOpen &&
      (hasStarted ||
        playbackState === "loading" ||
        playbackState === "ready" ||
        playbackState === "playing" ||
        playbackState === "preview_fallback")
    );
    if (shouldShowNowPlaying) {
      setNowPlaying(currentTrack);
      return;
    }
    if (!currentTrack || !hasStarted) {
      setNowPlaying(null);
    }
  }, [hasStarted, currentTrack, playbackState, previewModalOpen, featureModalOpen, albumModalOpen]);
```

### Playing indicator

```1491:1493:src/app/page.js
  const nowPlayingMatchesTrack =
    nowPlaying && currentTrack?.slug === nowPlaying.slug;
  const miniPlayerPlaying = Boolean(nowPlayingMatchesTrack && isPlaying);
```

### Desync scenarios

| Scenario | Audio | UI |
|----------|-------|-----|
| Viewport pause | Paused, `currentTrack` set | `nowPlaying` still set, `miniPlayerPlaying` false → **paused bar, visible shell** |
| `openFeatureModal` | New track via `playCanonicalCatalogItem` | `setNowPlaying(null)` first → **brief hide** then effect repopulates |
| `dismissNowPlaying` | `pause()` stops audio | `nowPlaying` null — aligned |
| Modal open blocks sync | Playing but `featureModalOpen` | `shouldShowNowPlaying` false — may **not** update `nowPlaying` until close |
| Slug mismatch | `currentTrack` changed | `nowPlayingMatchesTrack` false → play icon wrong |

---

## 3. MediaEngine bridge lag

`useMediaEngine` uses `useSyncExternalStore(subscribeMediaEngine, getMediaEngineSnapshot)` with reference caching in `getMediaEngineSnapshot` (L105–112 `useMediaEngine.js`).

- Notifications fire from `notifyMediaEngineBridge()` on state sync and progress (AudioContext L1031, L647).
- **Risk:** rapid `patchState` bursts during stream load may coalesce; consumers see stepped updates, not wrong ownership.
- `GlobalAudioPlayerBar` uses `engineIsPlaying ?? isPlaying` — masks brief null bridge during first mount.

---

## 4. page.js render churn vs stable audio

### Churn sources (no audio remount)

| Source | Location | Effect on audio |
|--------|----------|-----------------|
| `authLoading` / `accountState` | `useAuth`, `useEntitlementAccountState` | Re-render page; may change playable metadata |
| `tabKey` increment | `switchTab` L1660, `switchMusicSubTab` L1734 | Remounts tab subtree; **AudioProvider unaffected** |
| 1 Hz live countdown | page effects | Constant re-renders |
| Hero parallax | scroll handler L858+ | DOM style mutation only |
| Catalog fetch | `browseSingles` | `recordPlaybackTraceContext({ lastCatalogRenderAt })` |

### Audio listener rebind

`AudioContext` attaches `play`/`pause`/… listeners in `useEffect` with **`authLoading` in dependency array** (L1678). When bootstrap completes:

1. All listeners removed and re-attached.
2. No element teardown, but **micro-window** where events could be missed.
3. Classifier may attribute spurious pauses to entitlement churn (Phase 6C category B/D).

---

## 5. IntersectionObserver stale closure

`AudioVisualsSection` observer effect uses **`[]` deps** (L467) while `isMobile` sets threshold at mount only.

| Issue | Impact |
|-------|--------|
| `onAudioVisualsFocused` / `Exit` captured from first render | If callbacks were unstable, could call stale viewport API — mitigated by `useCallback` in Page |
| `isMobile` not in deps | Wrong threshold after resize until section remount |
| Cleanup calls `onAudioVisualsExit` if `hasBeenInView` | Unmount while in view → exit resume may fire |

---

## 6. Secondary media elements

| Element | Behavior when music plays |
|---------|---------------------------|
| Ambient refs | Paused when `isPlaying` (L1222–1228) |
| Carousel `<video>` | Independent play/pause (L786–805) |
| YouTube AV iframe | `postMessage` play/pause; **does not** drive AudioContext except via viewport callbacks |

**User perception:** “video took focus” = music paused by design (6B), not desync — unless exit resume fails.

---

## 7. Trace-assisted correlation (Phase 6C)

When desync reported in dev:

1. Filter `[playback-event]` for `pauseForViewport` / `resumeInternal` / `pauseInternal`.
2. `[render-churn] AudioProvider` with `reasonGuess: auth | entitlement`.
3. `[ui-churn] intersection` target `audioVisuals`.
4. `[playback-stop-snapshot]` — compare `isPlaying` in snapshot vs visible mini player.

---

## 8. False “desync” vs real bugs

| Observation | Classification |
|-------------|----------------|
| Music stops entering AV section | **Policy (6B)**, not desync |
| Music does not return leaving AV | **Resume failure** (viewport/controller conflict) |
| Mini player shows track while paused | **UI mirror lag** — acceptable if pause intentional |
| Mini player play button does nothing | **nowPlaying slug mismatch** or `userPausedRef` / gesture lock |
| Locks flicker after login | **Entitlement EMPTY→full** — UI only |
| Whole tab animates | **tabKey** — false reload feel |
