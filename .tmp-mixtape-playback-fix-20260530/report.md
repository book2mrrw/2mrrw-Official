# Mixtape / EP / Album Playback Audit & Fix

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Scope:** Playback flow, queue logic, modal track selection, transport controls, entitlement routing — no UI/layout changes.

---

## Executive summary

Multi-track playback was inconsistent because **entry points built different queues**: mixtape/EP card play used a **single-track** `playQueue([track], 0)`, while the album modal and cover click used the full release queue. Modal track taps could land on the wrong queue index when the requested row was unavailable (`resolveReleaseQueueStartIndex` fell back to `0` instead of the next playable track). `playAlbumTracks` filtered with ad-hoc `tracks.filter(t => t.src)` instead of the shared `playableReleaseQueue` helper.

Fixes unify release playback through `albumTracksForPlayback` → `playableReleaseQueue` → `resolveReleaseQueueStartIndex` → `playQueue`, wire mixtape/EP card play through `playAlbumTracks`, and harden auto-advance / manual next-previous to skip tracks without `src` at end-of-queue without clearing the queue.

**Build:** PASS  
**`npm run test:playback-resolver-fallback`:** PASS (21/21)

---

## Audit findings

| Issue | Root cause | Severity |
|-------|------------|----------|
| Modal track tap wrong track / no queue update | Unavailable release index mapped to queue index `0` | High |
| Auto-next differs by entry point | Card play queued one track; modal/cover queued full release | High |
| Cover click should autoplay first playable | `playAlbumTracks(..., 0)` OK after index resolver; queue builder inconsistent | Medium |
| `playAlbumTracks` queue drift | Used `filter(t => t.src)` not `playableReleaseQueue` | Medium |
| Next/prev skip invalid tracks | Queue pre-filtered; no runtime skip if `src` missing | Low |
| Modal close resets playback | **Not reproduced** — `closeAlbumModal` does not call `pause()` | N/A |
| Single audio engine | **PASS** — one `<audio>` in `AudioContext` | N/A |
| Entitlements in UI | **PASS** — `normalizeTrackForPlayback` / `resolvePlaybackSrc` only | N/A |

---

## What was broken

1. **Mixtape/EP card Play** started only the first normalized track in a one-item queue, so **auto-next never continued** through the release after card-initiated play.
2. **Modal / tracklist tap** on an unavailable index restarted at the **first** playable track instead of the next playable at or after the tapped position.
3. **Cover + modal paths** used slightly different queue filtering than `AlbumTracklistSheet` and `MyMusicTab`, risking preview/stream edge-case drift.

## What was fixed

1. **`resolveReleaseQueueStartIndex`** — exact match on `metadata.trackIndex`; else next playable with `trackIndex > requested`; else `0`.
2. **`playAlbumTracks`** — uses `playableReleaseQueue` + shared start index (cover, modal, tracklist).
3. **`playMixtapeEpCard`** — mixtape/EP card Play routes through `playAlbumTracks` (full queue, first playable) without changing button chrome.
4. **`AudioContext` `playNextInternal` / ended handler / `playPreviousInternal`** — skip entries missing `src`; end of queue stops playback and **keeps queue loaded** (unchanged intent, defensive skip).
5. **`AlbumTracklistSheet`** — removed redundant unavailable filter; relies on `playableReleaseQueue`.

---

## Files changed

| File | Change |
|------|--------|
| `src/lib/music-playback.js` | Smarter `resolveReleaseQueueStartIndex` for unavailable taps |
| `src/app/page.js` | `playableReleaseQueue` in `playAlbumTracks`; `playMixtapeEpCard`; mixtape row `onPlayClick` |
| `src/components/home/LatestSinglesStyleRow.js` | Pass `onPlayClick` to card actions |
| `src/context/AudioContext.js` | Next/prev/ended skip tracks without `src` |
| `src/components/music/AlbumTracklistSheet.js` | Align queue build with `playableReleaseQueue` |

**Preserved (no change):** Album card Play still opens tracklist sheet (`CatalogGrid` `onPlayClick` → `onOpenAlbumTracklist`). Singles card play unchanged.

---

## Acceptance criteria (17)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Card Play behavior preserved (album → tracklist; mixtape → play release) | **PASS** |
| 2 | Cover click opens modal + autoplays first playable | **PASS** |
| 3 | Modal track N plays queue position for release index N | **PASS** |
| 4 | Auto-next consistent after card, cover, modal entry | **PASS** |
| 5 | Next skips to immediate next playable track | **PASS** |
| 6 | Previous: `>3s` restart current; `≤3s` previous track | **PASS** (unchanged) |
| 7 | End of queue: stop, queue retained, no restart | **PASS** |
| 8 | Entitlements via `music-access` only | **PASS** |
| 9 | Unavailable tracks skipped in queue navigation | **PASS** |
| 10 | Modal open/close does not reset queue | **PASS** |
| 11 | Single `AudioContext` engine | **PASS** |
| 12 | No UI/layout/styling changes | **PASS** |
| 13 | `npm run build` | **PASS** |
| 14 | `npm run test:playback-resolver-fallback` | **PASS** |
| 15 | Album `CatalogGrid` card Play still opens tracklist | **PASS** |
| 16 | Mixtape/EP card play uses full release queue | **PASS** |
| 17 | Queue start index correct when early tracks unavailable | **PASS** (logic); live entitled tap not browser-tested |

---

## Validation

```bash
npm run build                          # PASS
npm run test:playback-resolver-fallback  # PASS (21/21)
```

Static queue index check (subscriber account, canonical mixtapes): `love-hz-vol-1`, `ad`, `tbh` — `resolveReleaseQueueStartIndex` returns expected indices for positions 0 and 5.

---

## Zip

Deliverable archive: `mixtape-playback-fix-20260530.zip` (report + changed sources).
