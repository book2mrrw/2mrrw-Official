# Phase P4 — Media card video stability + track metadata integrity

**Date:** 2026-06-03  
**Mode:** Root-cause analysis + implementation  
**Repository:** `/Users/recharge/artist-platform`

---

## Executive summary

| Bug | Root cause (one-liner) | Fix |
|-----|------------------------|-----|
| **A — Latest Singles MP4 black on scroll** | `syncSinglesCarouselVideos` required cards to be **fully** inside the viewport (`left >= 0 && right <= vw`), paused off-edge cards with `preload="metadata"`, and did not re-sync on vertical page scroll — so partially visible cards stayed paused/black. | Relaxed partial visibility (≥35% width + vertical in-view), prioritize widest visible decoders, `preload="auto"` + poster background, re-sync on main scroll + row scroll. |
| **B — Track metadata mismatch** | Phase 21C continuity freeze blocked `PlaybackChromeIsland` nowPlaying updates after a prior track; playing a new single left UI on stale snapshot slug (e.g. `i-dont-believe-you` while `hour-glass` audio played). | Clear continuity snapshot on user-initiated track change in `playTrackInternal`; tighten `normalizeTrack` slug identity; align prewarm cache keys. |

Prior hardening preserved: P1–P3, R1, 20F–20H, 21A–C (21C freeze still applies on OS suspend; released on track change or transport reconcile).

---

## Bug A — Latest Singles MP4 black on scroll

### Repro
Load homepage → Latest Singles video cards black; horizontal/vertical scroll toggles appear/disappear; repeated black state.

### Root cause
1. **`syncSinglesCarouselVideos` (`page.js`)** used strict full horizontal containment. Edge cards during carousel scroll were paused immediately while still partially visible.
2. **`preload="metadata"`** on carousel `<video>` (`LatestSinglesStyleRow.js`) — Safari/iOS often shows black until decode after `play()`; paused off-edge cards never decoded.
3. **Scroll listener gap** — sync ran on singles row horizontal scroll and resize only, not on main vertical scroll; cards could remain paused after page scroll repositioned the row.
4. Not a React remount (Phase 20F isolation intact); DOM pause/play only.

### Fixes
| File | Change |
|------|--------|
| `src/app/page.js` | Partial visibility math (≥35% width, vertical in-view); sort by visible width; `video.load()` before play when `readyState < 2`; attach sync to `mainScrollRef` vertical scroll |
| `src/components/home/LatestSinglesStyleRow.js` | `preload="auto"`; `#0a0a0a` background under poster while loading |

### Validation notes (Bug A)
- `npm run build` — pass
- `npm run check:frontend-guardrails` — pass
- Manual: load home → singles row videos show poster/first frame; horizontal scroll keeps nearest two cards playing without black flicker; vertical page scroll re-syncs visibility; hero mobile pause/play coordination unchanged

---

## Bug B — Track metadata mismatch

### Repro
Play "Hour Glass" → mini player / chrome shows `i-dont-believe-you` (prior track slug).

### Root cause
1. **21C continuity freeze** — `PlaybackChromeIsland` skips live `nowPlaying` sync while `continuityFrozen === true`. A snapshot from a previous track (e.g. feature `i-dont-believe-you`) remained active when user tapped a new single; `currentTrack` updated in `AudioContext` but chrome stayed frozen on stale slug/title.
2. **Secondary:** `normalizeTrack` could fall back `slug` to raw `src` when slug fields were absent (display slug in edge cases).
3. **Secondary:** prewarm cache key mismatch (`hour-glass:0` vs `hour-glass:hour-glass`) prevented warmed metadata from being used on play tap (did not swap audio, but increased stale-metadata risk).

### Fixes
| File | Change |
|------|--------|
| `src/context/AudioContext.js` | `clearContinuityFreeze()` on new track identity in `playTrackInternal`; `normalizeTrack` prefers explicit slug/trackSlug over src |
| `src/components/storefront/PlaybackChromeIsland.js` | Add `currentTrack?.slug` to nowPlaying effect deps |
| `src/lib/playback/playback-prewarm-cache.js` | `playbackPrewarmKeyForItem()` shared key builder |
| `src/components/music/ReleaseCardPlayButton.js` | Use shared prewarm key |

### Validation notes (Bug B)
- Play feature then single (or after background/lock if 21C snapshot existed) → displayed title matches playing track
- `resolvePlayerDisplayTitle` receives `currentTrack.title` ("Hour Glass"), not stale slug
- 21C OS suspend freeze still captures/restores on lock/unlock without remount

---

## Files changed

- `src/app/page.js`
- `src/components/home/LatestSinglesStyleRow.js`
- `src/context/AudioContext.js`
- `src/components/storefront/PlaybackChromeIsland.js`
- `src/lib/playback/playback-prewarm-cache.js`
- `src/components/music/ReleaseCardPlayButton.js`
- `docs/audits/PHASE_P4_MEDIA_CARD_VIDEO_AND_METADATA.md` (this file)

---

## Build / guardrails

```text
npm run build                 → exit 0 (Next.js 16.2.4, compiled successfully)
npm run check:frontend-guardrails → exit 0
```

---

## Commit

`Phase P4: stabilize Latest Singles video covers and fix track metadata display integrity`
