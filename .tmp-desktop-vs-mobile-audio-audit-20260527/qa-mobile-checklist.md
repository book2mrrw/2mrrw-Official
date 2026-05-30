# QA Mobile Checklist (DevTools / Safari Web Inspector)

Use **real device** or Simulator with remote inspection. Production: `https://www.2mrrw.com`.

## Setup

- [ ] Use `www` host (not apex) for entire session
- [ ] Note iOS version / Safari vs in-app browser (Instagram, etc.)
- [ ] Clear site data OR use fresh Private tab for baseline
- [ ] Enable **Disable Cross-Site Tracking** test separately (ITP stress)

## A. Session / cookies (before play)

| Check | How | Pass |
|-------|-----|------|
| Auth cookies | Application → Cookies | Chunked `2mrrw-auth-token` (or project pattern) present after login |
| No stale guest | Same panel | `guest_session` absent after OTP fan login |
| Account state | Network → `/api/account/state` | `permissions.admin` / `subscriber` match account type; `user` not null |
| Guest baseline | Logged out | `user: null`, `permissions.guest: true` |

## B. Stream API (during play)

Open Network, filter `library/stream`.

| Scenario | Expected | Fail signal |
|----------|----------|-------------|
| Guest tap preview | Preview CDN loads; stream may 401 | Only preview audible |
| Subscriber entitled | `GET ...&redirect=1` → **302** to `*.r2.cloudflarestorage.com` or CDN | **401** = session broken |
| Not entitled | stream **403** or preview only | Full file plays without purchase |
| Admin | 302 full stream; UI no pricing | 401/403 or preview-only |

Record for report:

- Status code
- Request cookies (count only — don't paste values)
- Response `location` host on redirect

## C. Audio element state (Console)

While “playing” but silent, run:

```javascript
const a = document.querySelector('audio');
({
  paused: a.paused,
  muted: a.muted,
  volume: a.volume,
  currentTime: a.currentTime,
  readyState: a.readyState,
  crossOrigin: a.crossOrigin,
  src: a.currentSrc?.slice(0, 80),
});
```

| Signal | Interpretation |
|--------|----------------|
| `paused: true`, UI playing | `play()` failed or `playAudioIfNotPaused` bug |
| `volume: 0` | first-listen swell / fade stuck |
| `currentTime` advancing, silent | Web Audio / CORS graph issue |
| `crossOrigin: "anonymous"`, R2 host | Check R2 CORS headers on media request |

## D. Web Audio (Console)

```javascript
// After first play attempt — may need breakpoint in initWebAudio
// Inspect via React DevTools or global if exposed
```

| Check | Pass |
|-------|------|
| `AudioContext.state` | `running` during playback |
| Manual `audio.play()` after user tap | sound returns |

## E. Gesture / path tests

| Step | Action | Pass |
|------|--------|------|
| E1 | Cold load → tap single cover (modal) | Audio starts **without** extra tap |
| E2 | Repeat after hard refresh during auth spinner | If fail → note authLoading defer bug |
| E3 | Card ▶ only (no modal) | Starts in &lt;300ms |
| E4 | Pause → play from modal toggle | Resumes with sound |
| E5 | Pause → play from global bar | Resumes with sound |
| E6 | Switch app 10s → return | Resumes or clear “tap to play” (document which) |

## F. Preview vs full

| Account | Expected audio | Max length |
|---------|----------------|------------|
| Guest | Preview | ~30s cap |
| Subscriber | Full | track length |
| Admin | Full | track length |

At 30s preview: fade + stop (`playbackState: ended_preview`).

## G. Regressions to watch

- [ ] Concurrent stream 409 dialog
- [ ] CS mode toggle still plays
- [ ] Bluetooth / AirPlay route (optional)
- [ ] Service worker: no failed `sw.js` registration blocking play

## H. Log capture for engineering

Export HAR or screenshots:

1. Failed `library/stream` row
2. `/api/account/state` JSON (redact email)
3. Console `[AUDIO]` or `[stream-client]` errors
4. `play()` rejection message if any (`NotAllowedError`)

## Production curl reference (no auth)

```bash
curl -sS -o /dev/null -w "%{http_code}" "https://www.2mrrw.com/api/library/stream?slug=hour-glass"
# Expect 401 without cookies

curl -sS "https://www.2mrrw.com/api/account/state" | head -c 200
# Expect guest-shaped JSON without cookies
```

Authenticated behavior **cannot** be validated with curl alone.
