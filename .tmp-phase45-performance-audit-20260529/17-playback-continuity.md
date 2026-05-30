# 17 — Playback Continuity (Remounts, Route Transitions, Media Session)

## Single audio element architecture

**File:** `src/context/AudioContext.js` L2955–2962

One hidden `<audio>` in AudioProvider — survives route changes within layout.  
**Correct:** No second audio element; aligns with platform guardrails.

## Layout persistence

**File:** `src/app/layout.js`

AudioProvider wraps `{children}` — navigating to `/subscribe` keeps audio alive if using Next client navigation.

**Hard nav breaks continuity:** `window.location.href="/subscribe"` (page.js L1805) — full reload, audio stops.

## Route transition matrix

| Navigation | Audio continues? | Notes |
|------------|------------------|-------|
| Tab switch (in page.js) | Yes | Same mount |
| Next Link to /subscribe | Yes | Same layout providers |
| window.location.href | No | Full reload |
| Modal open/close | Yes | No audio remount |
| Auth gate overlay | Yes | AppAuthRoot keeps children mounted |

## Media Session API

**Functions:** `updateMediaSession`, `rehydrateMediaSession`, `persistMediaSessionTrack`  
**File:** `src/lib/media-session-artwork.js`, `AudioContext.js` L615+

**Handlers:**
- Artwork metadata async fetch
- Position state throttled 1s (`POSITION_STATE_THROTTLE_MS` L55)
- Lock screen controls wired to dispatchPlaybackCommand

## Visibility / lifecycle

- `visibilitychange` — pause/resume policy (see `07-mobile-safari.md`)
- `pagehide` — saves playback position
- `beforeunload` — persists media session track
- `pageshow` (bfcache) — rehydrates media session

## Service worker

**File:** `public/sw.js` — KEEP_ALIVE ping from AudioContext every 20s  
Purpose: Android Chrome background session — minimal, no fetch caching of audio.

## Stream session continuity

- Stream metadata in `streamMetaRef` — sessionId, streamEventId
- URL refresh on visibility if near expiry (L2640–2667)
- Concurrent stream conflict UI — user override path

## Position memory

**Files:** `src/lib/playback/position-memory.js`  
- localStorage keyed by userId + slug
- Saved on interval 15s, pagehide, track change
- Restore on play with near-end clamping

## Remount risks

| Scenario | Risk |
|----------|------|
| AudioProvider remount | Low — only on full app remount |
| page.js remount | Medium — tab state lost; audio continues |
| Fast Refresh (dev) | High — known dev-only issue |

## Findings

1. **Architecture preserves continuity** across in-app navigation — strength.
2. **Hard link to /subscribe** — breaks playback unnecessarily.
3. **iOS visibility** may require user gesture to resume — platform constraint, handled conservatively.
4. **MediaSession position sync throttled** — good for battery; lock screen may lag 1s.

## Validation checklist

- [ ] Play track → navigate to /subscribe via Link → confirm audio continues
- [ ] Play track → tap Subscribe button (hard nav) → confirm stop (document behavior)
- [ ] Lock screen controls: skip/pause while app backgrounded
