# Silent playback fix — 2026-05-27

## Summary

Targeted fixes in `src/context/AudioContext.js` for cross-origin signed R2 streams routed through Web Audio (`createMediaElementSource`) and Safari’s suspended `AudioContext` after user gestures.

## Changes

### 1. `crossOrigin="anonymous"` on hidden `<audio>` (primary)

**Why:** Without CORS-enabled media, `createMediaElementSource` can produce silent output when `src` is a cross-origin signed R2 URL. `crossOrigin="anonymous"` allows the element to participate in the Web Audio graph when the origin sends `Access-Control-Allow-Origin`.

**Where:** Hidden playback element in `AudioProvider` JSX (~line 2094–2100).

```jsx
<audio
  ref={audioRef}
  preload="auto"
  playsInline
  crossOrigin="anonymous"
  ...
/>
```

### 2. Await `AudioContext.resume()` (secondary — Safari)

**Why:** Safari starts `AudioContext` in `suspended` and requires `resume()` inside a user gesture. Fire-and-forget `void ctx.resume()` can race before `audio.play()`.

**Where:**

| Location | Before | After |
|----------|--------|-------|
| Module helper (~103–112) | — | `resumeWebAudioContextIfSuspended(ctxRef)` awaits `ctx.resume()` when `state === "suspended"` |
| `playTrack` (~997–998) | `void audioCtxRef.current.resume()` | `await resumeWebAudioContextIfSuspended(audioCtxRef)` after `initWebAudio()` |
| `resume` (~1628–1630) | only `audio.play()` | `initWebAudio()` + `await resumeWebAudioContextIfSuspended(audioCtxRef)` then `audio.play()` (covers `toggle` unpause) |

No queue, transport, or architecture changes.

## Verification

- [x] `npm run build` — exit 0
- [x] `grep crossOrigin src/context/AudioContext.js` — `crossOrigin="anonymous"` on `<audio>`

## Post-deploy manual checklist

1. Signed library track plays with audible output (not silent) in Chrome/Safari.
2. Pause → play (toggle / media session) restores audio on Safari iOS/macOS.
3. Web Audio analyser / bass boost still works during playback.
4. Network: stream URL returns CORS headers compatible with `anonymous` (R2 bucket CORS).

## Files changed

- `src/context/AudioContext.js`
