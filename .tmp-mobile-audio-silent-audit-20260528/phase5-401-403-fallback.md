# Phase 5 — 401/403 Fallback Current State

Primary handling block: `src/context/AudioContext.js:L1260-L1296`
- Fallback gate is `err?.status === 401 || (err?.status === 403 && !entitled)` (`L1262`).
- For allowed fallback, preview source is loaded via `void loadAudioSrcAndPlay(audio, previewFallbackSrc)` (`L1276`) and playback state is set to preview (`L1280-L1291`).

Retry block also mirrors same behavior: `src/context/AudioContext.js:L986-L1003`
- `retryErr?.status === 401 || (retryErr?.status === 403 && !entitled)` (`L988`).

Conclusion:
- 403 for entitled user: **does not fallback to preview** (correct intent).
- 401: **still falls back to preview** (correct intent).
- Silent risk remains possible because preview fallback uses async `loadAudioSrcAndPlay` and may still hit iOS gesture restrictions if called outside strict gesture chain.
