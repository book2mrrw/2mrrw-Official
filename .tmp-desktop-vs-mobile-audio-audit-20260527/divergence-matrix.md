# Desktop vs Mobile Divergence Matrix

| # | Dimension | Desktop (typical) | Mobile (Safari / Chrome) | Severity | File:line |
|---|-----------|-------------------|-------------------------|----------|-----------|
| 1 | **Auth cookie visibility** | Warm session; cookies sent reliably | ITP, cross-tab, Private mode; slower bootstrap | HIGH | `stream/route.js:109-112`, `supabase/client.js:9-15`, `server.js:12-14` |
| 2 | **storageKey alignment** | Fixed in tree (`2mrrw-auth-token`) | Same code — verify **deployed** build post-`922381d` | HIGH | `auth-storage-key.js:2` |
| 3 | **Guest session race** | Less visible | Stale `guest_session` + guest `account/state` can override admin entitlements | HIGH | `session-user.js:30-31`, `AuthContext.js:134-140`, `guest-session.js:48-56` |
| 4 | **Modal play timing** | `authLoading` false → `playTrack` in click | Deferred to `useEffect` → no gesture | HIGH | `page.js:1121-1126`, `970-990` |
| 5 | **Autoplay policy** | Lenient `play()` after load | Strict; requires sync gesture | HIGH | `AudioContext.js:1137-1146` vs `1862-1872`, `2110-2125` |
| 6 | **Web Audio suspended** | Often auto-resumes | Stays suspended until gesture | HIGH | `AudioContext.js:134-143`, `547-593` |
| 7 | **crossOrigin + R2** | May appear to work (volume/route) | Silent graph output common | HIGH | `AudioContext.js:526-536`, `2367` |
| 8 | **redirect=1 fast path** | Entitled skips background swap | Same — **if** `canStream` true in metadata | MED | `music-access.js:204-206`, `AudioContext.js:1217-1218` |
| 9 | **backgroundStreamResolve** | Rare for entitled | Preview-first + background fetch → 401 noise | MED | `AudioContext.js:1214-1216`, `1325-1328` |
| 10 | **playAudioIfNotPaused** | Bug present; masked by redirect path | Background swap leaves paused element | MED | `AudioContext.js:123-131`, `1308` |
| 11 | **Stream API 401** | Uncommon when logged in | Same endpoint — fails if cookies missing | HIGH | `stream-client.js:70-90` |
| 12 | **Stream API 403** | Entitlement | Wrong slug / expired sub — same | MED | `stream/route.js:40-44` |
| 13 | **Preview 30s cap** | Same code | Same — feels worse on mobile UX | LOW | `AudioContext.js:57`, `759-780` |
| 14 | **useMediaEngine vs playTrack** | Same bridge | Modal toggle lacks `playTrack` unlock | MED | `useMediaEngine.js:126`, `ImmersivePreviewModal.js:508-512` |
| 15 | **Card vs modal** | Card: direct `playQueue` in click | Modal: auth defer risk | HIGH | `ReleaseCardPlayButton.js:58`, `page.js:1126` |
| 16 | **Player bar tap delay** | 300ms double-tap window | Feels unresponsive | LOW | `GlobalAudioPlayerBar.js:453-515`, `constants.js:8` |
| 17 | **Visibility / app switch** | Often resumes | `setTimeout` + `play()` may fail | MED | `AudioContext.js:2076-2126` |
| 18 | **onOnline handler** | Retries stream | Same — can fire without gesture | LOW | `AudioContext.js:1040-1045`, `911-924` |
| 19 | **localStorage position** | Works | Partitioned in Private mode | LOW | `position-memory.js:9-26` |
| 20 | **Service worker** | Registered | Same; ACK only | LOW | `public/sw.js`, `AudioContext.js:424-446` |
| 21 | **AirPlay** | N/A | External route may mute | LOW | `AudioContext.js:2368` |
| 22 | **Apex vs www** | Usually www | Bookmark to `2mrrw.com` drops cookies on redirect | MED | `next.config` redirect, stream-session audit |
| 23 | **Admin entitlement** | Full stream | Preview + pricing if server sees guest | HIGH | `music-access.js:65-71`, `129-130` |
| 24 | **credentials on fetch** | `include` | Same | — | `stream-client.js:67` |
| 25 | **CS hold / double-tap** | Mouse | Touch hold conflicts with play | LOW | `GlobalAudioPlayerBar.js:433-507` |

## Path equivalence summary

| Path | Desktop | Mobile difference |
|------|---------|-------------------|
| Card play → `playQueue` → `playTrack` | Gesture in handler | Same **if** no auth defer |
| Modal open → `playTrack` | Usually in handler | Often **useEffect** after auth |
| Bar toggle → `resume` | Works | May need unlock |
| Entitled stream | `redirect=1` → 302 R2 | + Web Audio CORS stricter |
| Guest preview | CDN preview | + 401 on background stream fetch |

## Code paths that are NOT divergent

- `useMediaEngine` is a thin mapper over `AudioContext` (`useMediaEngine.js:147-150`) — not a second engine.
- Stream client always same-origin relative URL (`stream-client.js:66`).
- Middleware runs for stream on all devices (`middleware.js:17-20`).
