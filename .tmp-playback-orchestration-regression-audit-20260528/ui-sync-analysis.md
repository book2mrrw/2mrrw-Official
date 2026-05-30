# UI synchronization analysis

## Consumer pathways verified

- `GlobalAudioPlayerBar` reads playback via `useImmersivePlayback` + `useMediaEngine`.
- Hard render gate in `src/components/audio/GlobalAudioPlayerBar.js:580`:
  - `if (!hasStarted || !currentTrack) return null;`
- Bridge notifier exists and is wired:
  - `src/context/AudioContext.js:671-679` updates refs + `notifyMediaEngineBridge()`
  - `src/context/AudioContext.js:681-704` registers bridge snapshot source

## Why UI does not initialize

- Sync pipeline itself is intact.
- Upstream command drop (at `AudioContext.js:2137`) prevents `hasStarted/currentTrack` from ever being set.
- Because of gate at `GlobalAudioPlayerBar.js:580`, UI never mounts even though sync subscription architecture is healthy.

## Propagation fields checked

- `currentTrack`: mapped in `src/media/useMediaEngine.js:109-125`
- `isPlaying`: mapped in same block (`115`)
- `hasStarted`: consumed directly from `useAudioPlayer` in `GlobalAudioPlayerBar`, not via bridge state
- Net: no propagation bug found; state never enters started path due orchestration guard.
