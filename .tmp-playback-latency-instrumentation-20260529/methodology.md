# Methodology — playback latency instrumentation

## Goal

Measure seven intervals between eight milestones:

**Tap → Play Request → Resolver → Signed URL → Source Assignment → First Byte → CanPlay → Audible**

## Instrumentation (client)

1. Run `npm run dev` (development `NODE_ENV` required).
2. Open Chrome DevTools → Console.
3. Tap play on a track (preview or entitled stream).
4. On first `playing` event, inspect `console.table` from `dumpPlaybackTiming()` or run `window.dumpPlaybackTiming()`.
5. Copy `window.__2mrrwLastPlaybackTiming` for reports.

Marks are defined in `src/lib/dev/performanceMarks.js` and wired in `AudioContext.js` + `stream-client.js`.

## Browser matrix (targets)

| Target | How to emulate | Notes |
|--------|----------------|-------|
| Desktop Chrome | Default devtools | Primary capture environment |
| Mobile Safari 375px | DevTools device toolbar → iPhone, throttle "Fast 3G" optional | iOS audio unlock path runs (`unlockAudioFromGesture`) |
| Mobile Chrome | DevTools → Pixel / Nexus, same throttle | Validates Chromium mobile |

**Production (`https://www.2mrrw.com`):** marks are disabled. Use Network panel Resource Timing on `<audio>` or repeat tests on localhost dev.

## Content matrix

| Content | Slug examples | Expected path |
|---------|---------------|---------------|
| Preview MP3 | `hour-glass`, `artificial` | `/api/media/preview` → 302 → R2 `.mp3` |
| Preview WAV | `2-heavy` (if configured) | Same resolver, `.wav` extension |
| Full stream (entitled) | `love-hz-vol-1`, `tbh` | `/api/library/stream?redirect=1` proxy |
| Full stream JSON+HEAD | Legacy / refresh paths | `fetchLibraryStream` + HEAD |

Canonical slugs: `src/lib/media/canonical-catalog.js`.

## API timing (curl)

Unauthenticated production probes (2026-05-30):

```bash
# Guest session (establishes cookie)
curl -sS -c /tmp/cookies.txt -o /dev/null -w "guest %{time_total}s\n" \
  https://www.2mrrw.com/api/guest/session

# Preview discovery (302 to CDN)
curl -sS -D - -o /dev/null \
  "https://www.2mrrw.com/api/media/preview?folder=previews/singles/hour-glass/&type=preview"

# Library stream (401 without entitlement cookie)
curl -sS -b /tmp/cookies.txt -o /dev/null -w "stream %{time_starttransfer}s\n" \
  "https://www.2mrrw.com/api/library/stream?slug=hour-glass"
```

Authenticated stream timing requires a fan session cookie from login — not automated in this pass.

## Mapping curl → pipeline stages

| Stage | curl proxy |
|-------|----------------|
| Resolver | `GET /api/library/stream?slug=` TTFB (JSON path) or redirect TTFB |
| Signed URL | `HEAD` on CDN URL from preview 302 `Location` |
| First byte | `curl -r 0-65535` TTFB on CDN |
| Tap→audible | Not available via curl — browser only |

## Live vs estimated

| Measurement type | Source this pass |
|------------------|------------------|
| **Live** | Production curl: guest session, preview 302, CDN HEAD/range, stream 401 TTFB |
| **Estimated** | Browser tap→audible (dev marks); entitled stream resolve; mobile Safari — from Phase 4.5 audit + code path analysis |

Localhost dev server was unavailable during capture (ports 3000/3456 timeout); browser mark capture deferred to follow-up on `npm run dev`.

## Validation checklist

- [ ] Dev: preview play — resolver marks `null`, tap→audible populated
- [ ] Dev: entitled play — redirect path, partial marks
- [ ] Dev: JSON stream path — all resolver/signed-url marks populated
- [ ] iOS: first tap after cold load vs warm
- [ ] Compare `playback-tap-to-audible` vs HAR `audio` resource `responseEnd`
