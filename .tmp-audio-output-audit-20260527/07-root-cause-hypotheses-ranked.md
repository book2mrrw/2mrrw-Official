# 07 — Root Cause Hypotheses (Ranked)

Date: 2026-05-27  
Method: Evidence from code trace + browser probe limits. **Not fix proposals** — verification steps included.

---

## Rank 1 — Web Audio graph + cross-origin R2 without `crossOrigin` on `<audio>`

**Likelihood:** HIGH  
**Evidence type:** CONFIRMED-CODE + CONFIRMED-SPEC (NEEDS-RUNTIME on prod session)

### Evidence

1. `initWebAudio()` attaches `createMediaElementSource` on first play (`AudioContext.js:451`).
2. After attachment, element audio routes **only** through graph to `ctx.destination` (browser spec).
3. Production `<audio>` has **no** `crossOrigin` attribute (`AudioContext.js:2083-2089`).
4. Entitled playback resolves to signed **R2 URLs** (cross-origin from `www.2mrrw.com`) via redirect or JSON swap.
5. R2 CORS headers exist for site origins (`.tmp-platform-readonly-audit-20260526/files/r2-cors-recommended-from-docs.json`) but require element `crossOrigin="anonymous"` for Web Audio sample access.
6. User symptom fit: **stream 206 OK**, **UI playing**, **no sound** — classic CORS-silent MediaElementSource pattern.

### Distinguishing test (NEEDS-RUNTIME)

Authenticated DevTools:

```javascript
const a = document.querySelector('audio');
({
  crossOrigin: a.crossOrigin,       // expect "" 
  currentSrc: a.currentSrc,         // expect R2 host
  paused: a.paused,
  volume: a.volume,
  muted: a.muted,
  currentTime: a.currentTime,       // advancing?
});
```

- If `currentTime` advances, `volume > 0`, `muted === false`, still silent → **strong match**.
- Check waveform/`getAnalyser` frequency data — non-flat implies graph signal present (less likely this hypothesis).

### Counter-evidence

- If `initWebAudio` throws and graph never attaches, direct element output might be audible (`:467-469` catch).

---

## Rank 2 — Suspended `AudioContext` (resume not awaited / missing on toggle)

**Likelihood:** HIGH (Safari/iOS), MEDIUM (desktop Chrome)  
**Evidence type:** CONFIRMED-CODE (NEEDS-RUNTIME)

### Evidence

1. `void audioCtxRef.current.resume()` — promise ignored (`AudioContext.js:987-989`).
2. `resume()` toggle calls `audio.play()` only — **no** context resume (`:1614-1622`).
3. Background swap / error retry call `audio.play()` without context resume (`:817`, `:1148`, `:1653`).
4. No global gesture unlock or `onstatechange` handler.
5. Symptom fit: element `play` events fire, `currentTime` advances, Web Audio graph silent.

### Distinguishing test (NEEDS-RUNTIME)

Breakpoint in `initWebAudio` after creation; inspect `ctx.state`:

- `"suspended"` during silent playback → **match**.
- Manual `await ctx.resume()` in console restores sound → **confirmed**.

---

## Rank 3 — `playAudioIfNotPaused` inverted logic after src swap

**Likelihood:** MEDIUM (preview→full background path), LOW (redirect=1 entitled fast path)  
**Evidence type:** CONFIRMED-CODE (NEEDS-RUNTIME)

### Evidence

```92:100:src/context/AudioContext.js
async function playAudioIfNotPaused(audio) {
  if (audio.paused) return;  // exits when paused — does NOT play
  try {
    await audio.play();
```

Used after signed URL swap:

```1148:1148:src/context/AudioContext.js
      if (stateRef.current.isPlaying) await playAudioIfNotPaused(audio);
```

1. `waitAudioSrcReady` assigns new src + `load()` — typically leaves element **paused**.
2. `stateRef.current.isPlaying` may still be `true` from prior preview.
3. Function returns without calling `play()` → **paused element, UI may show playing** if state not synced via `onPause`.

### Distinguishing test (NEEDS-RUNTIME)

During silent playback:

```javascript
const a = document.querySelector('audio');
({ paused: a.paused, isPlayingUI: /* React state */ });
```

- `paused === true` + UI playing → **match** (especially after background swap).
- Entitled `redirect=1` path skips background swap — less applicable.

---

## Rank 4 — Element volume at 0 (first-listen swell / crossfade / slider)

**Likelihood:** LOW–MEDIUM  
**Evidence type:** CONFIRMED-CODE (NEEDS-RUNTIME)

### Evidence

- First-listen sets `volume = 0` then ramps (`:1286-1290`).
- Track-change crossfade drops volume (`:1240-1243`).
- Preview fade near 30s (`:640`).
- Immersive slider `setVolume` (`useMediaEngine.js:129-133`).

### Distinguishing test

`document.querySelector('audio').volume` — if 0 while silent, identify which path (first listen vs slider).

---

## Rank 5 — `initWebAudio` failure (InvalidStateError / duplicate source)

**Likelihood:** LOW  
**Evidence type:** CONFIRMED-CODE (NEEDS-RUNTIME)

### Evidence

- Single guard prevents duplicate (`:441`).
- Catch logs warning only (`:467-469`).
- If graph fails to attach, **direct** element output might work (opposite of silent graph — would produce sound unless other factors).

### Distinguishing test

Console for `[WebAudio] Could not init:` during play.

---

## Rank 6 — OS / device output routing

**Likelihood:** LOW (without user hardware context)  
**Evidence type:** NEEDS-RUNTIME

### Evidence

- Device change handler may pause when no `audiooutput` enumerated (`:901-912`) — Safari quirks.
- AirPlay allowed on element.
- Hidden `display:none` element — rare iOS restrictions.

---

## Hypothesis decision tree

```
Stream 206 + signed URL OK + UI playing + no sound
│
├─ <audio> exists? (authenticated)
│   NO → AuthGate blocks AudioProvider (AppAuthRoot.js:29-31)
│   YES ↓
│
├─ audio.paused === true?
│   YES → Rank 3 (playAudioIfNotPaused) or play() failure
│   NO ↓
│
├─ audio.volume === 0 or muted?
│   YES → Rank 4
│   NO ↓
│
├─ initWebAudio succeeded? (no [WebAudio] warn)
│   NO → Rank 5 (may paradoxically allow direct output)
│   YES ↓
│
├─ AudioContext.state === 'suspended'?
│   YES → Rank 2
│   NO ↓
│
├─ crossOrigin null + currentSrc cross-origin R2?
│   YES → Rank 1 (strongest)
│   NO → Rank 6 / codec error (audio.error)
```

---

## Top 3 for executive summary

1. **Cross-origin signed R2 + Web Audio `createMediaElementSource` without `crossOrigin="anonymous"` on `<audio>`** — graph receives silence while decode/play state advances.
2. **Suspended Web Audio `AudioContext`** — `resume()` fire-and-forget; missing on toggle/reswap paths.
3. **`playAudioIfNotPaused` logic bug** — after background signed-URL swap, element stays paused while UI may indicate playing.
