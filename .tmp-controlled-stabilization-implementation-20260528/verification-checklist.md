# Verification Checklist

- [x] `npm run build` passes.
- [x] Playback-critical silent `.catch(() => {})` removed in `src/context/AudioContext.js`.
- [x] Singles/features/albums continue using canonical context entrypoints (`playTrack`/`playQueue`) from shared `useAudioPlayer`.
- [x] Public API shape of `AudioContext` playback controls preserved for consumers.
