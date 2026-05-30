# Hidden Architectural Divergence Map

## Divergence A: Playback authority split
- State authority: `AudioContext` refs + React state (`src/context/AudioContext.js`).
- Control projection: `useMediaEngine` mapping (`src/media/useMediaEngine.js`).
- UI control origins: `GlobalAudioPlayerBar`, `ImmersivePreviewModal`, `page.js`.
- Risk: eventual drift between projected state and command execution timing.

## Divergence B: Stream acquisition modes
- Mode 1: redirect stream src (`/api/library/stream?...&redirect=1`) from `resolvePlaybackSrc`.
- Mode 2: JSON prefetch + HEAD verification (`fetchLibraryStream`).
- Risk: different startup latency/error semantics by path.

## Divergence C: Access/entitlement timing
- Resolver at play-time: `resolveTrackAccess`/`resolvePlaybackSrc`.
- Async state refresh: `AuthContext.refreshAccountState` and `/api/account/state`.
- Runtime promotion path: `entitlements:updated` -> `upgradeToFullStream`.
- Risk: preview/full mismatch windows under mobile transitions.

## Divergence D: Lifecycle recovery ownership
- Audio recovery: `AudioContext` visibility/pageshow/pagehide.
- Session recovery: `AuthContext` supabase/session fallback.
- SW behavior: keep-alive message only (`public/sw.js`).
- Risk: no single lifecycle coordinator for app switch and hydration restore.

## Divergence E: Queue and media-session sync
- Queue refs and state are maintained in parallel.
- Media session metadata updated from multiple handlers.
- Risk: lock-screen controls and in-app queue transitions diverge.

## Runtime corroboration notes
- Current production stream probe without auth returns 401 HTML response (runtime probe in this audit run), so range/206 behavior could not be directly verified against entitled session.
- Prior probe artifacts show R2 public preview assets serving `Accept-Ranges: bytes` and correct audio content types (`.tmp-features-no-audio-diagnostic-20260527/curl-probes.txt`, `.tmp-playback-performance-audit-20260527/raw-curl-probes.txt`).
