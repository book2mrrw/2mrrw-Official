# 07 Playback Pipeline Audit

## Trace: UI -> stream API -> signed URL
1. UI components trigger `playTrack(...)` through audio hooks/context (`src/app/page.js:511`, `src/components/music/MyMusicTab.js:325`).
2. Access resolution occurs via `resolveTrackAccess` and playback URL selection via `resolvePlaybackSrc` (`src/lib/music-access.js:103`, `:214`).
3. Entitled path resolves to `/api/library/stream?slug=...&redirect=1` (`src/lib/music-access.js:206`).
4. Audio engine recognizes library stream source and fetches stream metadata (`src/context/AudioContext.js:967`, `:795`).
5. Client helper hits `/api/library/stream` (`src/lib/playback/stream-client.js:3`, `:61`).
6. Server route checks entitlement and produces signed URL through cache/factory (`src/app/api/library/stream/route.js:41`, `:77`; `src/lib/playback/stream-url-cache.js:12`).

## Current-state risk points (descriptive, no fix proposals)
- Async dependency before stable playback for entitled routes is present in stream fetch path (`src/context/AudioContext.js:795`).
- Multiple guarded branches (401/403/409 classes) can produce diverging user-visible behavior by auth/device state (`src/app/api/library/stream/route.js:43`; conflict-related handling in `src/context/AudioContext.js:770`-`:782`).
- Preload path intentionally skips library stream URLs (`src/media/preloader/MediaPreloader.js:38`), so stream warm-up behavior depends on runtime path, not preload.

Evidence subset mirrored in `raw/02-playback-path-snippets.txt`.
