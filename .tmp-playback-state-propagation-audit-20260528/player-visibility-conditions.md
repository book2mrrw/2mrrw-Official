# Player Visibility Conditions

## Global player bar mount
`src/components/audio/GlobalAudioPlayerBar.js`:
- hard gate: `if (!hasStarted || !currentTrack) return null;`

So even if `isPlaying` is true, the bar stays hidden while `hasStarted` is false.

## Page-level now playing mini player
`src/app/page.js`:
- effect sets `nowPlaying` only when:
  - `hasStarted`
  - `currentTrack`
  - and no preview/feature/album modal open
- if `!hasStarted`, it clears `nowPlaying`.

Mobile mini player renders only when `nowPlaying` is set.

## Visibility outcome in regression
- `currentTrack` can be present.
- `playbackState` can be `"playing"`.
- `isPlaying` can be true.
- But both player surfaces remain hidden if `hasStarted` is left false.

