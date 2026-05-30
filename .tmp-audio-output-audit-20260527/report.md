# Audio Output Silent Playback Audit

Date: 2026-05-27  
Repo: `/Users/recharge/artist-platform`  
Type: Read-only code trace + limited browser probe  
Symptom: Stream infrastructure works (HTTP 206, signed R2 URL OK) but **no audible sound**.

---

## Executive summary

Production playback uses a **single hidden `<audio>` element** in `AudioProvider` (`src/context/AudioContext.js`). On first `playTrack()`, the code attaches a **Web Audio API graph** via `createMediaElementSource`, routing all output through `AnalyserNode → StereoPanner → BiquadFilter → destination`. Stream URLs resolve correctly to signed R2 (206 Partial Content).

The most evidence-backed explanations for **silent output while UI shows playing** are:

1. **Cross-origin media + Web Audio without `crossOrigin="anonymous"`** on the `<audio>` element (Rank 1).
2. **Suspended `AudioContext`** with incomplete `resume()` handling (Rank 2).
3. **`playAudioIfNotPaused` inverted logic** leaving element paused after signed-URL background swap (Rank 3).

No code changes were made. No commits.

---

## Browser probe results

| Probe | Result | Status |
|-------|--------|--------|
| Navigate `https://www.2mrrw.com` | AuthGate / join screen | CONFIRMED-RUNTIME |
| `document.querySelectorAll('audio').length` | `0` (after 3s) | CONFIRMED-RUNTIME |
| CDP audio property inspection | N/A — no element | BLOCKED |
| AudioContext.state | N/A — requires auth + play | NEEDS-RUNTIME |

**Limit:** `AppAuthRoot` returns `<AuthGate>` before `AudioProvider` mounts for unauthenticated visitors (`src/components/auth/AppAuthRoot.js:29-31`). Authenticated playback inspection requires OTP sign-in.

---

## Architecture (one paragraph)

User click → `playTrack` / `playQueue` → optional `/api/library/stream` redirect or JSON signed URL → `waitAudioSrcReady` sets `audio.src` → `audio.play()` → element events set React `isPlaying` → parallel Web Audio graph (first play) taps element into analyser/waveform path to system output.

---

## Deliverables index

| File | Contents |
|------|----------|
| `01-playback-flow-trace.md` | Click → stream → src → play → Web Audio sequence |
| `02-audio-element-state.md` | muted/volume/paused/src/error handlers |
| `03-audiocontext-state.md` | Browser AudioContext lifecycle, resume gaps |
| `04-media-node-graph.md` | Node chain, CORS, duplicate source guards |
| `05-optimization-impact.md` | Preload, media engine, deferred init impact |
| `06-safari-compatibility.md` | iOS/WebKit gesture, playsInline, crossOrigin |
| `07-root-cause-hypotheses-ranked.md` | Evidence-based ranked hypotheses |
| `manifest.txt` | File listing |

---

## Top 3 most likely silent-output causes

### 1. Web Audio + cross-origin R2 without `crossOrigin` (HIGH)

- **Evidence:** `createMediaElementSource` at `AudioContext.js:451`; no `crossOrigin` on element `:2083-2089`; signed R2 is cross-origin; R2 CORS configured but element attribute missing.
- **Symptom fit:** 206 OK, playing UI, silence.
- **Verify:** DevTools — `audio.crossOrigin`, `audio.currentSrc` host, analyser data vs audible output.

### 2. Suspended AudioContext (HIGH on Safari, MEDIUM elsewhere)

- **Evidence:** `void ctx.resume()` not awaited `:987-989`; `resume()` omits ctx.resume `:1614-1622`.
- **Verify:** Breakpoint in `initWebAudio`; check `ctx.state === 'running'`.

### 3. `playAudioIfNotPaused` after src swap (MEDIUM)

- **Evidence:** Returns when `audio.paused` `:92-93`; used in `swapToSignedStream` `:1148`.
- **Verify:** `audio.paused === true` while UI `isPlaying === true` after stream upgrade.

---

## Recommended next verification (no code)

Authenticated session on production:

1. Open DevTools → play track with 206 stream.
2. Inspect `<audio>`: `paused`, `volume`, `muted`, `crossOrigin`, `currentSrc`, `error`.
3. Break in `initWebAudio`: log `ctx.state` before/after `resume()`.
4. Observe floating waveform — moving vs flat.
5. If available, repeat on iOS Safari.

---

## Files referenced (primary)

- `src/context/AudioContext.js` — engine, graph, element
- `src/lib/playback/stream-client.js` — signed URL fetch
- `src/lib/music-access.js` — redirect src resolution
- `src/media/useMediaEngine.js` — subscription facade
- `src/components/auth/AppAuthRoot.js` — auth gate blocks audio mount
- `src/components/system/AudioPhase10Bridge.js` — queue preload bridge
