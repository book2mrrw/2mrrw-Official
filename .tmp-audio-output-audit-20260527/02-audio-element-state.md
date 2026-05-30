# 02 — Audio Element State Audit

Date: 2026-05-27  
Scope: `<audio ref={audioRef}>` in `AudioProvider` only.

---

## Element definition

**CONFIRMED-CODE:**

```2083:2089:src/context/AudioContext.js
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        {...{ "webkit-playsinline": "", "x-webkit-airplay": "allow" }}
        style={{ display: "none" }}
      />
```

| Attribute | Value | Notes |
|-----------|-------|-------|
| `muted` | **not set** (default false) | No code sets `audio.muted = true` on main player |
| `volume` | default 1.0 | Manipulated in several paths (see below) |
| `crossOrigin` | **not set** | Critical for Web Audio + cross-origin R2 (see §06, §07) |
| `preload` | `"auto"` | |
| `playsInline` | true | Safari inline playback |
| visibility | `display: none` | Hidden; does not mute |

---

## Where `volume` is modified

| Location | File:line | Condition | Risk |
|----------|-----------|-----------|------|
| Preview hard-cap fade | `AudioContext.js:636-660` | `previewOnly && currentTime >= 28s` | Fade to 0 near 30s cap; reset to 1 on end or before fade window |
| Track-change crossfade | `AudioContext.js:1233-1254` | New track while playing, `currentTime > 3` | Drops to 0 in ~300ms then restores `startVol` |
| First-listen swell | `AudioContext.js:1285-1292` | `isFirstListen(slug)` | Starts at 0, ramps +0.033 every 100ms (~3s to full) |
| Media engine setVolume | `useMediaEngine.js:129-133` | User slider in immersive controls | Clamps 0–1 |
| Preview fade restore | `AudioContext.js:659-660` | Preview, before fade window | Restores volume if `< 1` |

**CONFIRMED-CODE:** First-listen swell does not call `markListened` in `AudioContext`; `markListened` is only invoked from `ImmersivePreviewModal.js:795`. Card/home play via `ReleaseCardPlayButton` can trigger swell without modal mark — swell still completes to 1 unless interrupted.

**NEEDS-RUNTIME:** Verify `audio.volume` during silent playback (DevTools: `$0.volume` on `<audio>`).

---

## Where `paused` is set / play() called

| Action | File:line | Notes |
|--------|-----------|-------|
| `audio.pause()` before new src | `:1258-1259` | Expected during track change |
| `pause()` callback | `:1609-1611` | Sets `userPausedRef` |
| `loadAudioSrcAndPlay` | `:81-84` | Calls `play()` after src ready |
| `playAudioIfNotPaused` | `:92-100` | **Only calls play when NOT paused** (see §07) |
| `swapToSignedStream` | `:1148` | Uses `playAudioIfNotPaused` |
| `upgradeToFullStream` | `:1380` | Uses `playAudioIfNotPaused` |
| `resume()` stale URL refresh | `:1653` | Uses `playAudioIfNotPaused` |
| CS hold preview | `:1923-1940` | Pause, swap src, conditional play |
| `stop()` | `:1737-1740` | Pause + removeAttribute src |
| Device change handler | `:907-908` | Pauses if no audiooutput devices |
| Preview end | `:643-644` | Hard pause at 30s preview cap |

---

## `currentSrc` / `src` assignment paths

All assignments go through `waitAudioSrcReady(audio, src)` → `audio.src = src; audio.load()`.

Primary callers:
- `loadAudioSrcAndPlay` — `:60-61`
- `playTrack` new track — `:1260`
- `swapToSignedStream` — `:1139`
- `upgradeToFullStream` — `:1354`
- `applyCSModeToTrack` / `toggleCSMode` — `:1451`, `:1494`
- `onError` stream retry — `:805`
- `beginCsHoldPreview` / `endCsHoldPreview` — `:1926`, `:1973`
- `resume()` URL refresh — `:1642`

**CONFIRMED-CODE:** Entitled stream initial src is same-origin redirect:

`/api/library/stream?slug=...&redirect=1` → browser follows to cross-origin signed R2 URL (`currentSrc` becomes R2 host).

---

## Error handlers on element

**CONFIRMED-CODE:** Registered in mount effect `:888-899`:

- `error` → `onError` (`:766-882`) — stream retry, preview fallback, error UI
- `waiting` / `stalled` → buffering state
- `emptied` → reset currentTime/duration
- `ended` → queue advance / preview end

**CONFIRMED-CODE:** `waitAudioSrcReady` treats `error` event same as `canplay` (resolves anyway after error). Playback may proceed to `play()` on a broken element.

```74:76:src/context/AudioContext.js
    audio.addEventListener("canplay", finish);
    audio.addEventListener("canplaythrough", finish);
    audio.addEventListener("error", finish);
```

**NEEDS-RUNTIME:** Check `audio.error` (MediaError code) when silent but `isPlaying` true.

---

## readyState / networkState checks

**CONFIRMED-CODE:** No explicit `readyState >= HAVE_CURRENT_DATA` gate before `play()`. Relies on `canplay` event or 3s timeout in `waitAudioSrcReady`.

**CONFIRMED-CODE:** Progress RAF stops when `audio.paused || audio.ended` (`:365-367`).

---

## Scenarios: UI shows playing but output silent

| # | Scenario | Evidence | Verification |
|---|----------|----------|--------------|
| 1 | Element paused after src swap; state still `isPlaying` | `playAudioIfNotPaused` skips play when paused (`:92-93`); `swapToSignedStream` doesn't patch state | **NEEDS-RUNTIME** |
| 2 | `volume === 0` during first-listen swell | `:1286-1290` | **NEEDS-RUNTIME** — should ramp within 3s |
| 3 | `volume === 0` mid crossfade (interrupted navigation) | `:1240-1253` — 300ms timeout restores | **NEEDS-RUNTIME** |
| 4 | Preview fade near 30s | `:640` | Only preview tracks |
| 5 | Web Audio graph active; element `play` events fire | `createMediaElementSource` disconnects direct output | **NEEDS-RUNTIME** — check graph + context |
| 6 | `audio.play()` NotAllowedError swallowed | Logged except AbortError; state may desync | **NEEDS-RUNTIME** |
| 7 | User volume slider at 0 | `PreviewPlayerControls.js:245` → `setVolume` | **NEEDS-RUNTIME** |

**CONFIRMED-CODE:** `muted` is never set on the production `<audio>` element in this codebase.

---

## Secondary Audio instances (not main player)

| Instance | File | Impact on main output |
|----------|------|----------------------|
| CS preload | `AudioContext.js:246-250` | Separate element; no graph hookup |
| MediaPreloader warm | `MediaPreloader.js:22-25` | Discarded warm element |
| Ambient loops | `src/app/page.js:924` | Separate `Audio()` at volume 0.07 |
| Vault UI sounds | `src/lib/vault-audio.js` | Separate Web Audio context |

**CONFIRMED-CODE:** No second `createMediaElementSource` on the main element (guard at `:441`).
