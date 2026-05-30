# Phase 4 — Preload / Prefetch

## Mechanisms

| Location | Behavior |
|----------|----------|
| `ImagePipeline.js:65-78` | `<link rel="preload" as="image">` + critical queue |
| `MediaPreloader.js:7-39` | Audio `<link rel="preload">`; **skips** `/api/library/stream` URLs |
| `page.js:786-798` | Home tab: preload first N catalog covers via `imagePipeline.preload` |
| `page.js:1809,1918` | `<video preload="auto|metadata">` cinematic / modal |
| `AudioContext.js:265-289` | CS cover video/audio warm (`preloadCsAssets`) |
| `preloadCoverImage` | Delegates to ImagePipeline |
| `ReleaseCardPlayButton.js` | `preloadTrack` on hover intent |

## Dead / stale preload hrefs

- **None identified** with fixed broken URL in link tags.
- `catalogMotionVideoUrl("videos/A2B.mp4")` — resolved via `lib/media-urls` (R2/CDN); not a static dead `/public` path.
- Next.js document `<link rel="preload" as="script">` in 404 HTML is framework noise, not app bug.

## Budget telemetry

- `preloadBudget.js` — `preload.budget.exceeded` logged at warn tier; cosmetic.

## Action

**No preload removals** in Phase B.
