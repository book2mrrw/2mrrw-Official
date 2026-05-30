# 03 — AudioContext (Web Audio API) State Audit

Date: 2026-05-27  
Note: This document covers the **browser `AudioContext` API** (`window.AudioContext`), not the React context module `src/context/AudioContext.js`.

---

## Creation and singleton guard

**CONFIRMED-CODE:**

```440:470:src/context/AudioContext.js
  const initWebAudio = useCallback(() => {
    if (audioCtxRef.current || typeof window === "undefined") return;
    const audio = audioRef.current;
    if (!audio) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      // ... nodes ...
      audioCtxRef.current = ctx;
    } catch (e) {
      console.warn("[WebAudio] Could not init:", e);
    }
  }, []);
```

| Property | Value |
|----------|-------|
| Creation trigger | First `playTrack()` call (`:986`) |
| Singleton | `audioCtxRef.current` guard — one context per provider lifetime |
| Safari prefix | `window.webkitAudioContext` fallback (`:445`) |
| Failure mode | Warn + continue; element plays without graph (**audible via direct path only if graph never attached**) |

---

## State: suspended vs running

**CONFIRMED-CODE:** Resume attempt on every `playTrack`:

```986:989:src/context/AudioContext.js
    initWebAudio();
    if (audioCtxRef.current?.state === "suspended") {
      void audioCtxRef.current.resume();
    }
```

| Issue | Detail | Status |
|-------|--------|--------|
| Not awaited | `void ctx.resume()` — promise result ignored | **CONFIRMED-CODE** |
| No resume on `resume()` toggle | `resume()` callback (`:1614-1676`) calls `audio.play()` only, **no** `audioCtxRef.current.resume()` | **CONFIRMED-CODE** |
| No document-level unlock listener | No global `click`/`touchstart` handler to resume suspended context | **CONFIRMED-CODE** |
| No state change listener | No `ctx.onstatechange` recovery | **CONFIRMED-CODE** |

**NEEDS-RUNTIME:** In DevTools during silent playback:

```javascript
// After user click play
document.querySelector('audio'); // must exist (authenticated)
// Context not exposed on window — probe via hook or breakpoint in initWebAudio
// Expected: ctx.state === 'running' for audible Web Audio output
```

---

## User gesture requirements

**CONFIRMED-CODE:** First `playTrack` is invoked from click handlers (e.g. `ReleaseCardPlayButton.js:95` `onClick={handlePlay}`), which satisfies autoplay policy for `audio.play()` in most browsers.

**CONFIRMED-CODE:** Web Audio `AudioContext.resume()` also requires user gesture when autoplay policy blocks audio. Same click invokes `playTrack` → `initWebAudio` + `resume()` — timing race possible if `resume()` resolves after gesture expires.

**NEEDS-RUNTIME:** Safari iOS — verify `AudioContext.state` after play button tap.

---

## Destination connection path

**CONFIRMED-CODE:** Full chain to speakers:

```
MediaElementSourceNode (source)
  → AnalyserNode (fftSize 256)
  → StereoPannerNode (pan 0)
  → BiquadFilterNode (lowshelf 200Hz, gain 0 dB default)
  → AudioContext.destination
```

```458:461:src/context/AudioContext.js
      source.connect(analyser);
      analyser.connect(stereoPanner);
      stereoPanner.connect(bassFilter);
      bassFilter.connect(ctx.destination);
```

**CONFIRMED-CODE:** No alternate routing (no `MediaStreamDestination`, no offline context). `spaceMode` toggles UI state only — **does not** modify Web Audio graph (`:472-475`).

**CONFIRMED-CODE:** Bass boost sets filter gain to 8 dB when enabled (`:479-484`); default 0 dB is pass-through, not silence.

---

## Analyser tap (visualization only)

**CONFIRMED-CODE:** Analyser is inline in signal path (not parallel tap). `fftSize = 256` does not attenuate signal.

**CONFIRMED-CODE:** Exposed via bridge for waveform UI:

```525:526:src/context/AudioContext.js
      getAnalyser: () => analyserRef.current,
```

Used in `PreviewPlayerControls.js:261` (`FloatingWaveform`).

**NEEDS-RUNTIME:** If waveform animates during silence, graph receives samples → issue is downstream (destination/context). If waveform flat, upstream silence (CORS or muted media stream).

---

## Interaction with HTMLMediaElement routing

**CONFIRMED-CODE (browser spec):** Once `createMediaElementSource(audio)` succeeds, the media element's audio is **removed from the default output** and available only through the `MediaElementAudioSourceNode`.

Implications:
- Suspended `AudioContext` → **no audible output** even if `audio.paused === false` and `currentTime` advances.
- CORS-blocked media element → **silent node output** (element may still decode/play internally).
- Failed `initWebAudio` → element may use default output (audible if volume > 0).

---

## Separate AudioContext: vault-audio.js

**CONFIRMED-CODE:** `src/lib/vault-audio.js:47-49` creates independent context for vault UI sounds. Does not share nodes with main player.

**CONFIRMED-CODE:** No interference with main `audioCtxRef` unless browser-wide audio policy blocks all contexts.

---

## Recovery gaps (code-level)

| Gap | File:line |
|-----|-----------|
| `resume()` omits Web Audio context resume | `AudioContext.js:1614-1622` |
| Background src swap omits context resume | `swapToSignedStream :1134-1148` |
| Stream error retry omits context resume | `onError :816-817` |
| No retry if `initWebAudio` throws | `:467-469` |

---

## Verification checklist (DevTools)

**NEEDS-RUNTIME** (authenticated session required):

1. Breakpoint or log in `initWebAudio` — confirm graph created once.
2. After play click: `ctx.state` should be `"running"`.
3. If `"suspended"`, run `await ctx.resume()` manually — if sound appears, root cause is context resume gap.
4. Compare: temporarily bypass graph (only in DevTools experiment) — if sound returns, graph routing is involved.
