# Playback Fixes Implementation Report

**Date:** 2026-05-31  
**Scope:** Targeted playback fixes from entitlement/playback audits — no architecture redesign.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/music-playback.js` | Added `isSamePlaybackTrack()`; enhanced `resolveReleaseQueueStartIndex()` with track-id lookup |
| `src/components/music/AlbumTracklistSheet.js` | Fixed `isTrackActive`; pass source track to queue resolver |
| `src/context/AudioContext.js` | Preview 15s cap; identity-aware same-track detection; seek routing; preview auto-advance guard |
| `src/components/audio/GlobalAudioPlayerBar.js` | `PREVIEW_MAX_SEC` 30 → 15 |
| `src/app/page.js` | Pass source track to `resolveReleaseQueueStartIndex` in `playAlbumTracks` |

---

## Functions Modified

### `src/lib/music-playback.js`
- **`isSamePlaybackTrack(a, b)`** *(new)* — stable identity: `id`, then `albumSlug + trackIndex`, then slug (singles only)
- **`resolveReleaseQueueStartIndex(playableTracks, releaseTrackIndex, sourceTrack?)`** — prefers `sourceTrack.id` before index fallback

### `src/components/music/AlbumTracklistSheet.js`
- **`isTrackActive(track)`** — uses `isSamePlaybackTrack` instead of shared release slug
- **`playAndClose`** — passes `tracks[releaseTrackIndex]` to queue resolver

### `src/context/AudioContext.js`
- **`PREVIEW_HARD_CAP_SEC`** — 30 → 15
- **`inferPlaybackScenario`** — same-track check via `isSamePlaybackTrack`
- **`playTrackInternal`** — `sameIdentity` / session finalization via `isSamePlaybackTrack`
- **`playNextInternal({ autoAdvance })`** — blocks queue auto-advance when `autoAdvance && previewOnly`
- **`executePlaybackCommand`** — `COMPLETE` passes `{ autoAdvance: true }`; `NEXT_TRACK` remains manual
- **`seekBack` / `seekForward`** — delegate to `seekInternal` (preview cap applied)

### `src/components/audio/GlobalAudioPlayerBar.js`
- **`PREVIEW_MAX_SEC`** — 30 → 15 (scrub bar + dock duration cap)

### `src/app/page.js`
- **`playAlbumTracks`** — passes source track to queue resolver

---

## Fix #1 — Track Identity (AlbumTracklistSheet)

### Before
```javascript
const sameId =
  currentTrack.id === track.id ||
  currentTrack.slug === track.slug ||  // ← all album tracks share release slug
  (currentTrack.metadata?.trackIndex === index && currentTrack.metadata?.albumSlug === album?.slug);
```
Any album track matched the current track via shared release slug → wrong row showed active → `toggle()` instead of `playQueue()`.

### After
```javascript
return isSamePlaybackTrack(currentTrack, track);
// id match → albumSlug+trackIndex → slug (non-album)
```
Only the actually playing track row is active; other rows call `playAndClose(index)`.

---

## Fix #2 — Queue Index Drift

### Before
`resolveReleaseQueueStartIndex(playable, releaseTrackIndex)` matched by `metadata.trackIndex` only. When non-playable tracks were filtered from the queue, index-only fallback could drift to “next at or after” instead of the tapped track.

### After
1. Look up by `sourceTrack.id` (`${albumSlug}:${trackSlug}`) in the playable queue first.
2. Fall back to `trackIndex` exact match, then next-at-or-after.

Callers (`AlbumTracklistSheet.playAndClose`, `page.js playAlbumTracks`) pass the full source track object.

---

## Fix #3 — Guest Preview 15s (Not 30s)

| Constant | Before | After |
|----------|--------|-------|
| `PREVIEW_HARD_CAP_SEC` (AudioContext) | 30 | **15** |
| `PREVIEW_MAX_SEC` (GlobalAudioPlayerBar) | 30 | **15** |

**Guest behavior:**
- Preview fades/stops at 15s (`onTime` handler + `onEnded` preview branch)
- Any track row is playable via `playQueue` (identity fix removes false-active block)
- **No auto-advance after preview:** `playNextInternal({ autoAdvance: true })` returns early when `previewOnly`; `onEnded` preview path returns before `finishEnded` queue advance

**Entitled users:** Full playback unchanged; `onEnded` → `finishEnded` auto-next still runs when `previewOnly` is false.

---

## Fix #4 — Seek Consistency

| Path | Before | After |
|------|--------|-------|
| Scrub bar `onSeek` | `seekInternal` (capped) | unchanged |
| `seekBack(15)` / `seekForward(15)` | direct `audio.currentTime` (uncapped) | **`seekInternal`** |
| Media Session `seekto` / `seekbackward` / `seekforward` | `seek()` → `seekInternal` | unchanged (already capped) |
| AlbumTracklistSheet ±15 buttons | `seekBack` / `seekForward` | inherit capped routing |

Preview seeks clamp to `PREVIEW_HARD_CAP_SEC` (15s) everywhere.

---

## Fix #5 — Manual Selection Override

- **`isSamePlaybackTrack`** in `playTrackInternal` — selecting a different album track is no longer treated as “same track” because release slug matches
- **`playQueue`** already uses `cancelActiveStream: true` — new selection stops current stream and starts at resolved queue index
- **AlbumTracklistSheet** — non-active rows always call `playAndClose(index)`; active row pause/resume uses `toggle()`

---

## Verification Results

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** (Next.js 16.2.4, compiled successfully) |
| `npm run test:playback-resolver-fallback` | **PASS** (21/21 scenarios) |

---

## Test Matrix (Manual QA by Tier)

| Tier | Track select (album sheet) | Preview duration | Seek ±15 / scrub | Auto-next on end |
|------|---------------------------|------------------|------------------|------------------|
| **Guest** | Tap track N → plays track N (not toggle wrong row) | Stops at 15s, “PREVIEW ENDED” CTA | Capped at 15s | **No** auto-advance |
| **Subscriber** | Same identity fix; full stream | Full track | Uncapped (full duration) | Yes (queue/repeat rules) |
| **Owner / Vault** | Same | Full track | Uncapped | Yes |
| **Collector** | Same | Full track | Uncapped | Yes |

### Suggested device checks
1. Guest: open album tracklist → play track 3 → confirm track 3 row highlights (not track 1)
2. Guest: let preview run → stops ~15s, no next track starts
3. Guest: scrub/±15 near end → cannot pass 15s
4. Guest: while track 1 preview playing, tap track 4 → track 4 starts immediately
5. Subscriber: same album flow → full playback + auto-next at track end

---

## Out of Scope (per constraints)

- No playback engine / queue architecture redesign
- No entitlement source-of-truth changes
- No UI/visual redesign (`ImmersivePreviewModal` still shows 30s copy — separate modal surface)
- No dependency bumps
