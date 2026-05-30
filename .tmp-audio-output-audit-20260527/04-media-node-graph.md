# 04 — Media Node Graph Audit

Date: 2026-05-27

---

## Graph topology

**CONFIRMED-CODE:**

```
┌─────────────────────┐
│  <audio> element    │
│  (audioRef)         │
└──────────┬──────────┘
           │ createMediaElementSource (once)
           ▼
┌─────────────────────┐
│ MediaElementSource  │  sourceRef
│ Node                │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ AnalyserNode        │  analyserRef (fftSize=256, smoothing=0.8)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ StereoPannerNode    │  stereoPannerRef (pan=0)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ BiquadFilterNode    │  bassFilterRef (lowshelf 200Hz, gain 0 default)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ ctx.destination     │  system speakers
└─────────────────────┘
```

Source: `src/context/AudioContext.js:448-461`

---

## Node parameters at init

| Node | Parameter | Initial value | Silence risk |
|------|-----------|---------------|--------------|
| Analyser | `fftSize` | 256 | None (pass-through) |
| Analyser | `smoothingTimeConstant` | 0.8 | None |
| StereoPanner | `pan.value` | 0 (center) | None |
| BiquadFilter | `type` | `lowshelf` | None |
| BiquadFilter | `frequency` | 200 Hz | None |
| BiquadFilter | `gain` | 0 dB | **Not mute** — unity on lowshelf |
| Bass boost ON | `gain` | 8 dB | Louder, not silent |

**CONFIRMED-CODE:** No `GainNode` with `gain.value = 0` in chain.

---

## Duplicate MediaElementSource (Safari)

**CONFIRMED-CODE:** Safari throws `InvalidStateError` if `createMediaElementSource` is called twice on the same element.

Guard prevents re-entry:

```441:441:src/context/AudioContext.js
    if (audioCtxRef.current || typeof window === "undefined") return;
```

**CONFIRMED-CODE:** No other file calls `createMediaElementSource` on the main player element.

**NEEDS-RUNTIME:** If `[WebAudio] Could not init` appears in console with InvalidStateError, graph failed but partial state possible — check `audioCtxRef.current` vs `sourceRef.current`.

---

## Disconnected nodes

**CONFIRMED-CODE:** Linear connect chain with no `disconnect()` calls anywhere in codebase for these nodes.

**CONFIRMED-CODE:** `stop()` clears element src but does **not** tear down Web Audio graph (`:1723-1753`). Graph persists for provider lifetime.

**NEEDS-RUNTIME:** After `stop()` + new `playTrack`, same graph reused — should remain connected.

---

## Cross-origin media + Web Audio (critical)

**CONFIRMED-CODE:** Main `<audio>` has **no** `crossOrigin` attribute (`AudioContext.js:2083-2089`).

**CONFIRMED-CODE:** Production stream resolves to signed **R2 URLs** (cross-origin from `www.2mrrw.com`).

**CONFIRMED-CODE:** R2 bucket CORS allows site origins (from prior audit artifact):

```1:14:.tmp-platform-readonly-audit-20260526/files/r2-cors-recommended-from-docs.json
[
  {
    "AllowedOrigins": [
      "https://www.2mrrw.com",
      ...
    ],
    "AllowedMethods": ["GET", "HEAD"],
    ...
  }
]
```

**Browser spec behavior (CONFIRMED-SPEC, NEEDS-RUNTIME on prod):** For cross-origin media, `MediaElementAudioSourceNode` outputs **silence** unless the media element's `crossOrigin` attribute is set to `"anonymous"` (or `"use-credentials"`) **before** src assignment, and the server returns appropriate CORS headers.

Sequence in code:
1. `initWebAudio()` → `createMediaElementSource(audio)` (no src or prior src)
2. `waitAudioSrcReady` → assigns cross-origin R2 URL

**NEEDS-RUNTIME:** In DevTools Network tab, verify R2 response includes `Access-Control-Allow-Origin`. In Elements, verify `crossOrigin` is null on `<audio>`.

---

## Wrong destination routing

**CONFIRMED-CODE:** Only connection target is `ctx.destination` (`:461`). No routing to `MediaStreamDestination`, recorder, or secondary context.

**CONFIRMED-CODE:** `spaceMode`, `atmosphereLevel`, `csMode` do not alter graph topology.

---

## Visualization branch

**CONFIRMED-CODE:** `FloatingWaveform` reads analyser frequency data (`PreviewPlayerControls.js:261`). Analyser is in-series, not a split that could leave main path disconnected.

**NEEDS-RUNTIME diagnostic:**
- Waveform moves + no sound → context suspended or OS output issue
- Waveform flat + `currentTime` advances → CORS/silent MediaElementSource or zero-volume element

---

## CS mode / hold preview graph impact

**CONFIRMED-CODE:** CS mode swaps `audio.src` and `playbackRate` (`applyCsToElement`, `:946-963`). Does not recreate MediaElementSource.

**CONFIRMED-CODE:** `beginCsHoldPreview` / `endCsHoldPreview` swap src on same element (`:1913-2005`). Graph unchanged.

---

## Graph init timing vs src assignment

**CONFIRMED-CODE order in `playTrack`:**

1. `initWebAudio()` — creates graph on current element
2. `audio.pause()` + `loadAudioSrcAndPlay(audio, syncSrc)` — assigns src

If cross-origin src loaded without `crossOrigin="anonymous"`, MediaElementSource may permanently output silence for that session (until element/graph recreated).

**NEEDS-RUNTIME:** Test play before/after hard refresh with cleared provider state.
