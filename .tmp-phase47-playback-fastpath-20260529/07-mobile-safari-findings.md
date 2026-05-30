# 07 — Mobile Safari Findings (Playback Startup)

Synthesis of Phase 4.5 `07-mobile-safari.md`, playback instrumentation, Phase 4.6 mobile ambient change, and Phase 4.7 analysis. **No new device captures** this pass.

## Playback-specific constraints

| Constraint | Implementation | Startup impact |
|------------|----------------|----------------|
| Audio autoplay | `unlockAudioFromGesture` before play | +5–80 ms first tap (**Est.**) |
| Web Audio suspend | `resumeWebAudioContextIfSuspended` | Same window as unlock |
| Single `<audio>` | `AudioProvider` one element | **Correct** — no double-element penalty |
| Visibility | iOS may not auto-resume after tab hide | Second tap after background — not startup, continuity |

## Resource contention at play time

| Source | Phase 4.6 / 4.5 | Playback interaction |
|--------|-------------------|----------------------|
| Hero MP4 | `preload="metadata"` (C1) | Less bandwidth fight with first audio byte |
| Carousel videos | Max 2 decoders + pause hero when carousel in view (C2) | Fewer decoder stalls before `canplay` |
| Ambient blur | `blur(72px)` mobile (C3) | Lower GPU load during immersive play |
| Main-thread React | Progress decoupled (A1/A2) | Faster tap→command drain under scroll+play |

## Network on mobile Safari (guest preview path)

Measured desktop curl approximates mobile RTT order-of-magnitude:

1. Preview API **~602 ms** (if folder redirect used)
2. CDN range **~954 ms** TTFB (64 KiB)
3. Full MP3 **~2131 ms** total download if not range-limited

Mobile Safari often benefits from cache after first play; cold cellular may exceed these values (**Pending** device test).

## iOS fast-path alignment

- Entitled: `redirect=1` avoids extra client round trips — **best for Safari connection limits**
- JSON+HEAD refresh on visibility: still risky on flaky LTE — recommend C1 in `06-recommended-fixes.md`

## Gaps requiring device validation

- [ ] First tap after cold load vs warm — `playback-request-to-resolver`
- [ ] Low Power Mode + hero video + play
- [ ] Background 30s → foreground — not startup; listed for continuity
- [ ] 375px tap→audible with dev marks

## Browser MCP note

Production https://www.2mrrw.com does not execute dev `performanceMarks` (`NODE_ENV=production`). Browser automation was not used for timing capture; curl + code path analysis only.
