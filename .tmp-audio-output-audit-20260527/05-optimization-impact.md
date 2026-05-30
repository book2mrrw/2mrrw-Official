# 05 — Recent Optimization Impact Audit

Date: 2026-05-27  
Scope: Preload, media engine bridge, cover transition, deferred init — impact on **audible routing** only.

---

## Summary

**CONFIRMED-CODE:** None of the optimization layers introduce a second playback engine or explicit mute. The primary silent-output risk from the "optimization stack" is indirect: **Web Audio graph attachment on first play** combined with **cross-origin stream URLs without `crossOrigin` on `<audio>`**.

---

## useMediaEngine / mediaEngineBridge

**CONFIRMED-CODE:** Subscription facade only; does not create audio nodes.

```108:141:src/media/useMediaEngine.js
export function mapAudioContextToMediaEngine(audio) {
  // ...
  return {
    state: { /* mirrors AudioContext state */ },
    play: (track) => audio.playTrack(mapMediaTrackToPlayInput(track)),
    pause: audio.pause,
    setVolume: (level) => { el.volume = v; },
    // ...
    analyser: bridge?.getAnalyser?.() ?? audio.getAnalyser?.() ?? null,
  };
}
```

**CONFIRMED-CODE:** Bridge registers snapshot + analyser ref (`AudioContext.js:506-527`). Read-only for output path.

**Audible impact:** None direct. `setVolume(0)` via slider could mute — user-controlled.

---

## MediaPreloader / useQueuePreloader

**CONFIRMED-CODE:** Skips library stream URLs for preload hints:

```38:40:src/media/preloader/MediaPreloader.js
  if (audioUrl && !String(audioUrl).includes("/api/library/stream")) {
    preloadAudioLink(audioUrl, trackId);
  }
```

**CONFIRMED-CODE:** Warm-up uses disposable `new Audio()` (`:22-25`), not main element.

**CONFIRMED-CODE:** `useQueuePreloader` (`AudioPhase10Bridge.js:14`) preloads upcoming queue artwork + preview URLs only.

**Audible impact:** None on main `<audio>`. Does not bypass Web Audio graph.

---

## AudioPhase10Bridge

**CONFIRMED-CODE:** Wires queue preloader + playback recovery events (`src/components/system/AudioPhase10Bridge.js`).

Recovery handler restores queue/seek but does **not** call `playTrack`/`play()` (`:24-40`, `onRestore: () => {}`).

**Audible impact:** None direct. Could leave queue restored but silent if user expects auto-resume — out of scope unless recovery fires without play.

---

## useCsCoverTransition

**CONFIRMED-CODE:** Cover art display only (`src/hooks/useCsCoverTransition.js`). CSS phase transitions on image/video display.

**Audible impact:** **None.** Does not touch audio element or Web Audio graph.

---

## Deferred / lazy Web Audio init

**CONFIRMED-CODE:** `initWebAudio()` deferred until first `playTrack()` (`:986`), not on provider mount.

**Impact analysis:**
- Before first play: element would use default output (if play occurred without init — it doesn't; init is first line of playTrack).
- After first play: **all** output routes through Web Audio graph.

This deferral is an optimization (avoid creating context on page load) but introduces the CORS/crossOrigin + suspended-context failure modes at first play.

---

## Redirect fast path (`redirect=1`)

**CONFIRMED-CODE:** `libraryStreamRedirectSrc` avoids JSON prefetch (`music-access.js:204-207`).

**CONFIRMED-CODE:** For entitled users, `backgroundStreamResolve` is false when `redirectFastPath` true — no `swapToSignedStream` / `playAudioIfNotPaused` path.

**Audible impact:** Reduces src-swap pause race (see §07 hypothesis #3) but **does not** bypass Web Audio graph or crossOrigin requirement.

---

## Background stream resolve (preview → full)

**CONFIRMED-CODE:** Unentitled or non-redirect paths start preview, then swap to signed URL in background (`AudioContext.js:1054-1056`, `:1165-1168`).

**Audible impact:** **Potential.** `swapToSignedStream` uses inverted `playAudioIfNotPaused` — if preview was playing and swap pauses element, playback may not resume (UI may still show playing).

---

## First-listen volume swell

**CONFIRMED-CODE:** `isFirstListen` localStorage gate (`src/lib/first-listen.js`).

```1285:1292:src/context/AudioContext.js
      if (isFirstListen(nextTrack.slug)) {
        audio.volume = 0;
        let vol = 0;
        const swell = setInterval(() => { vol = Math.min(1, vol + 0.033); audio.volume = vol; ... }, 100);
      }
```

**Audible impact:** Brief intentional silence (~3s ramp). Not permanent unless interval cleared abnormally.

---

## CS asset preload (separate Audio)

**CONFIRMED-CODE:** `preloadCsAssets` creates separate `Audio()` for csAudio (`:245-250`).

**Audible impact:** None on main output. Could consume decode budget on low-end devices — **NEEDS-RUNTIME** perf only.

---

## Image pipeline crossOrigin

**CONFIRMED-CODE:** Artwork preload sets `crossOrigin="anonymous"` on images/videos (`useCoverPalette.js:147-162`, `MediaPreloader.js:15`) — **not** applied to music `<audio>`.

**Audible impact:** Highlights asymmetry: visual pipeline respects CORS; audio element does not.

---

## Auth gate + AudioProvider mount order

**CONFIRMED-CODE:** `AppAuthRoot` blocks `AudioProvider` until OTP auth (`AppAuthRoot.js:29-31`).

**Audible impact:** No `<audio>` on join screen (browser confirmed 0 elements). First authenticated play creates element + graph cold — all first-play policies apply at once.

---

## Optimization verdict table

| Component | Bypasses audible routing? | Can mute output? |
|-----------|---------------------------|------------------|
| useMediaEngine | No | Only via setVolume(0) |
| MediaPreloader | No | No |
| useQueuePreloader | No | No |
| useCsCoverTransition | No | No |
| Deferred initWebAudio | Routes to Web Audio graph | Yes (indirect: CORS/suspended) |
| redirect=1 fast path | No | No |
| background swap | No | Yes (playAudioIfNotPaused bug) |
| first-listen swell | No | Temporary volume 0 |
