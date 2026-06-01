# Stream Swap Audit — Silence Risk

**Scope:** `upgradeToFullStream`, `retryStreamPlayback`, visibility/resume refresh, preview fallback (`AudioContext.js` + `stream-client.js`)

---

## Can these cause silence?

| Operation | Intentional stop? | Silence window? | Recovery |
|-----------|-------------------|-----------------|----------|
| `upgradeToFullStream` | No — uses `skipPauseInterruptionRef` + `waitAudioSrcReady` | **Brief gap** possible while swapping preview → signed URL | `playAudioIfNotPaused` if was playing L2270 |
| `retryStreamPlayback` | No | Re-runs `playTrackInternal` with `forceStream` | User tap retry UI |
| `resumeInternal` stream refresh | No | Background URL swap L2585–2610 | Keeps playing if swap succeeds |
| `visibilitychange` hidden refresh | No | Prefetch only L3057–3079 | No pause |
| `onError` stream retry | No | Retry then `audio.play()` L1397 | Preview fallback L1426–1447 |
| Preview hard cap | **Yes** | Pause at 15s L1152–1164 | Preview-ended UX |
| `ACCESS_DENIED` | **Yes** | `audio.pause()` L1453, L1806 | Error state; no auto-resume |
| `waitAudioSrcReady` timeout | **Yes** | Play fails → error state | User retry |
| CS mode / hold preview | Pause during swap | Short | Resume after load |

---

## `upgradeToFullStream` (L2178–2278)

**Triggers:**

1. `window` `entitlements:updated` when `meta.previewOnly && isPlaying` (listener checks track access L2291–2300) — **skipped if `authLoading`** L2283–2289  
2. `ReleaseCardPlayButton` manual `upgradeToFullStream()`  

**Early exit (no swap):** server `user.id` ≠ `listeningUserIdRef` L2187–2190 — **silent no-op** (hydration race risk)

**Swap:** `resolveLibraryStreamForTrack` → `waitAudioSrcReady` → seek restore → optional `playAudioIfNotPaused`

**Silence risk:** **Medium** — failed fetch leaves preview playing; successful swap may have 100–500ms+ gap; does **not** call `pause()` unless element already paused.

**Dispatch sites for `notifyEntitlementsUpdated`:**

- `page.js` L1453 (`checkout-success`)  
- `success/page.js` L129  

---

## `retryStreamPlayback` (L2327–2334)

Resets `streamErrorRetriedRef`, clears error flags, `playTrack(..., { forceStream: true })`.

**Silence risk:** **Low–Medium** — only after error state; replaces src via full play pipeline.

---

## `streamUrlNeedsRefresh` / `fetchLibraryStream`

- Used on resume, visibility hide, error retry  
- `STREAM_REFRESH_BEFORE_EXPIRY_MS` = 5 min (`stream-client.js` L7, L112–116)  
- Failed refresh: logged `VISIBILITY_STREAM_REFRESH_FAILED` / `RESUME_STREAM_REFRESH_FAILED` — **does not pause**

---

## Preview fallback paths

| Entry | Lines | Result if preview missing |
|-------|-------|---------------------------|
| `playTrackInternal` stream denied | L1766–1798 | Preview play or ACCESS_DENIED pause |
| `onError` after stream retry fail | L1414–1447 | Preview or hard stop |
| `onError` preview playback fail | L1477–1491 | `isPlaying: false`, "Preview unavailable" |

**Silence:** User hears stop when fallback unavailable or access denied — **by design**, not hydration.

---

## Concurrent stream / abort

`playTrackInternal` aborts `activeStreamAbortRef` L1662–1666 — in-flight resolve cancelled; **can** abort pending play if rapid track changes.

---

## Summary

| Scenario | Causes lasting silence? |
|----------|------------------------|
| Scroll AV `pause()` | **Yes** — until user resumes |
| `upgradeToFullStream` during play | Rare brief gap; not primary scroll cause |
| Auth `refreshAccountState` | **No** direct audio API |
| Stream 401 after entitlement change | **Next** play may fail; current element may keep until error event |
