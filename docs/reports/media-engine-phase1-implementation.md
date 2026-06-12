# Media Engine — Phase 1 Subscription Layer

**Date:** 2026-05-24  
**Commit message:** `feat: useMediaEngine subscription layer; AudioContext remains single engine`

## Architecture

| Layer | Module | Role |
|-------|--------|------|
| **Engine** | `src/context/AudioContext.js` | Production media engine: one `<audio>` ref, library stream URLs, RAF `currentTime`, listening history, CS mode, 403/409 / concurrent stream |
| **Subscription** | `src/media/useMediaEngine.js` | React hook — stable UI API over `useAudioPlayer()` |
| **Imperative facade** | `src/media/MediaEngine.js` | `getState()` / `subscribe()` for non-React code via bridge |
| **Bridge** | `src/media/mediaEngineBridge.js` | Registered once in `AudioProvider`; notified on state sync |
| **Immersive adapter** | `src/lib/player/useImmersivePlayback.js` | Dock/modals — delegates progress/toggle to `useMediaEngine`, spreads full context for stream/CS |

```
UI (PreviewPlayerControls, GlobalAudioPlayerBar, …)
        ↓ useMediaEngine / useImmersivePlayback
        ↓ useAudioPlayer()
AudioProvider ──► <audio ref={audioRef} />  (single element)
        ↓ playTrack / stream-client / RAF / webhooks path unchanged
```

## `useMediaEngine` API

```js
const { state, play, pause, seek, setVolume, toggle } = useMediaEngine();
```

- **`state`:** `{ currentTrack, isPlaying, currentTime, duration, volume, queue }`
- **`currentTrack`:** `{ id, slug, title, artist, artwork, audioUrl }` derived from context `currentTrack`
- **`play(track)`:** accepts `{ id, audioUrl, title, artist, artwork }` → `playTrack()` with slug/src/cover mapping
- **`setVolume`:** sets `audioRef.current.volume` (element owned by AudioContext; no second `Audio()`)

## What we did not do

- No `MediaEngine.ts` with `new Audio()` — sample TS file is conceptual only
- No replacement of `AudioProvider` or stream pipeline
- No duplicate playback state machine

## Phase 2 wiring

- **`PreviewPlayerControls`:** uses `useMediaEngine` for transport/progress; `useAudioPlayer` for `isBuffering`, stream retry, errors
- **`useImmersivePlayback`:** delegates core timing to `useMediaEngine`; unchanged public surface for `GlobalAudioPlayerBar`
- **`GlobalAudioPlayerBar`:** unchanged import (`useImmersivePlayback`) — zero behavior change by design

## Phase 3 polish

- **`FloatingMainPlayer`** / **`CompactDockPlayer`:** progress fill `width: N%` → `transform: scaleX(N/100)` (matches `PreviewPlayerControls` + `.player-immersive-progress-rail__fill` CSS)

## Files added

- `src/media/useMediaEngine.js`
- `src/media/MediaEngine.js`
- `src/media/mediaEngineBridge.js`
- `src/media/index.js`
- `docs/reports/media-engine-phase1-implementation.md`

## Files touched

- `src/context/AudioContext.js` — bridge register + notify on state sync
- `src/lib/player/useImmersivePlayback.js`
- `src/components/preview/immersive/PreviewPlayerControls.js`
- `src/components/player/ImmersivePlayerEngine/FloatingMainPlayer.js`
- `src/components/player/ImmersivePlayerEngine/CompactDockPlayer.js`

## Verification

```bash
npm run build
# lint touched paths (project eslint)
```

Manual: preview modal + global dock share one audible stream; scrubber uses RAF + scaleX fill; stream retry / CS / 403 flows unchanged.
