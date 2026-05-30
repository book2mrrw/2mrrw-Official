# 8. Safari mobile specifics

## Documented mitigations (AudioContext.js)

| Concern | Implementation |
|---------|----------------|
| Autoplay / gesture | `GESTURE_UNLOCK_EVENTS` capture listeners; `unlockAudioFromGesture`; ephemeral AudioContext unlock |
| Inline playback | `playsInline`, `webkit-playsinline` on `<audio>` |
| Web Audio suspended | `resumeWebAudioContextIfSuspended` before play; gesture hook |
| AirPlay | `x-webkit-airplay="allow"` |
| Media Session | `navigator.mediaSession` handlers + `setPositionState` (throttled 1s) |
| Interruption resume | `onPause` non-user → `canplay` listener auto-resume |
| Background | `visibilitychange` save position; refresh signed URL on hide; resume `play()` on visible |
| PWA | `isStandalonePwa()` — `beforeunload` skips some persist |
| Page restore | `pageshow` + `readPersistedMediaSessionTrack` |

## iOS-specific costs

1. **CrossOrigin anonymous** on audio — required for Web Audio `createMediaElementSource`; CORS must be correct on R2/CDN (public previews OK).
2. **Large WAV previews** — iOS may defer decode; worsens first play.
3. **302 redirect chains** — `2mrrw.com` → `www.2mrrw.com` adds RTT on stream API (observed 307).
4. **Media Session artwork** — multiple sizes from same URL; `preloadArtwork` before metadata.
5. **No Service Worker audio cache** — background depends on OS media element + KEEP_ALIVE ping (20s).

## `sendControlSystemPlaybackEvent`

- `keepalive: true` fetch — good for page hide; deduped progress 15s.

## Safari testing checklist (manual)

- [ ] Cold start: first tap play on single (MP3 preview) — time to sound
- [ ] Feature modal: WAV preview — compare to single
- [ ] Subscriber: full stream redirect — lock screen controls
- [ ] Background 5 min → foreground resume without 401
- [ ] Bluetooth connect mid-play (`devicechange` enumerate only)
- [ ] Low Power Mode
- [ ] Private browsing (guest session + stream)

## Plan

- Normalize stream API host (avoid 307 www bounce).
- Transcode feature previews to AAC/MP3 &lt;500KB.
- Optional: `playsinline` video covers already separate from audio path.
