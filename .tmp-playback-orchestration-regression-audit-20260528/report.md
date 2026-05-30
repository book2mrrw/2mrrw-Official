# Playback orchestration regression audit (commit 662d5ee)

## Top root cause

`executePlaybackCommand()` drops valid `PLAY_TRACK`/`PLAY_QUEUE` work when `activeCommandRef` is overwritten by another dispatch (especially non-serial commands), so first-play commands can resolve `false` before `playTrackInternal()` runs, leaving `hasStarted` false and preventing both audio and player UI initialization.

## Exact failure points

- `src/context/AudioContext.js:2137`  
  `if (command.requestId !== activeCommandRef.current?.requestId) return false;`  
  This stale-command gate is tied to mutable shared ref state instead of a stable per-command execution token.

- `src/context/AudioContext.js:2208-2210`  
  Serial queue chains commands, but stale rejection is evaluated against global `activeCommandRef`, not the queued command identity itself.

- `src/context/AudioContext.js:2231`  
  `seek()` is dispatched with `{ serial: false }`, so it can mutate `activeCommandRef` concurrently and trip the stale gate for queued play commands.

- `src/context/AudioContext.js:2202-2204`  
  `finally` cleanup clears `activeCommandRef` only if request IDs still match; concurrent commands can leave ref state desynchronized from currently executing queued command.

## Why this matches observed regression

- Entry points in `src/app/page.js` and `src/components/music/ReleaseCardPlayButton.js` still call `playTrack`/`playQueue`.
- When the stale gate returns `false`, `playTrackInternal()` does not run, so no `patchState({ hasStarted: true, ... })` occurs.
- `GlobalAudioPlayerBar` hard-gates on `hasStarted` and `currentTrack`; therefore the dock never appears.

## Scope confirmation

- No equivalent orchestration gate existed before this commit; it was introduced with command dispatcher refactor in `662d5ee`.
- Diagnostics helper additions are non-blocking and not causal.
