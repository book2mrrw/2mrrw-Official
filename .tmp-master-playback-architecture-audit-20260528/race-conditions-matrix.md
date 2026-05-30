# Race Conditions Matrix

| ID | Race | Trigger | Impact | Primary files |
|---|---|---|---|---|
| RC-1 | play request branch overlap | Rapid track switches | Wrong src/state applied after newer request | `src/context/AudioContext.js` |
| RC-2 | delayed ended vs queue mutation | End + user next/prev within 2s | Skip/repeat misfire | `src/context/AudioContext.js` |
| RC-3 | upgrade stream vs retry stream | entitlement update + network error | source swap churn/silence | `src/context/AudioContext.js` |
| RC-4 | entitlement event vs active playback | checkout/refresh while playing | preview/full oscillation | `src/context/AudioContext.js`, `src/app/page.js`, `src/context/AuthContext.js` |
| RC-5 | auth/account hydration lag | session restore under mobile conditions | stale access decisions at play tap | `src/context/AuthContext.js`, `src/app/api/account/state/route.js`, `src/lib/music-access.js` |
| RC-6 | signed URL cache vs refresh threshold | long session, nearing expiry | extra swaps/errors | `src/lib/playback/stream-url-cache.js`, `src/lib/playback/stream-client.js` |
| RC-7 | stream session clear/create churn | force stream, multi-device | phantom concurrent conflict or missed cleanup | `src/app/api/library/stream/route.js`, `src/lib/playback/stream-pipeline.js` |
| RC-8 | media session action vs ended pipeline | lock-screen next during end transition | queue desync | `src/context/AudioContext.js` |
| RC-9 | metadata rehydrate overwrite | visibility/pageshow during track change | stale lock-screen metadata | `src/context/AudioContext.js`, `src/lib/media-session-artwork.js` |
| RC-10 | modal/global/player command interleave | fast user gestures | inconsistent UI vs engine state | `src/components/preview/ImmersivePreviewModal.js`, `src/components/audio/GlobalAudioPlayerBar.js`, `src/app/page.js` |

## Permanent mitigation pattern
- Introduce serialized command processing and event-sourced reducer.
- Make stream/session lifecycle idempotent and acknowledged.
- Make entitlement/access changes versioned and monotonic relative to playback commands.
