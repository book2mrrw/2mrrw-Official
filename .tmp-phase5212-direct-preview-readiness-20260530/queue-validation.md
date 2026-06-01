# Queue Validation — Preview Redirect Dependency

**Section result: PASS**

Queue, auto-advance, previous/next, and resume do **not** depend on the `/api/media/preview` **redirect hop**. They depend on **pre-resolved `track.src` strings** produced upstream by `resolvePlaybackSrc` / `normalizeTrackForPlayback` / `toPlaybackTrack`.

---

## 1. `setQueue`

**File:** `src/context/AudioContext.js` (~L2322)

```javascript
const normalized = (tracks || []).map(normalizeTrack).filter((t) => t.src);
```

- Filters tracks with truthy `src` only.
- `src` is set at queue build time via `music-playback.js` (`playbackSrc = resolvePlaybackSrc(...)`).
- **Direct CDN:** `src` becomes CDN URL instead of API URL — **no queue logic change required**.

---

## 2. `playNext` / `playPrevious`

**Files:** `playNextInternal` / `playPreviousInternal` (~L2337–L2373)

- Advance index in `queueRef`, call `playTrackInternal(track, { resumeAt: 0 })`.
- Previous: if `currentTime > 3`, seek to 0; else decrement index.
- **No preview API fetch** in queue navigation — only reuses queued `track.src`.

---

## 3. Auto-advance

**File:** `onEnded` handler (~L1198–L1229)

- On track end: compute `nextIndex` (shuffle / repeat-all), then:
  `playTrackRef.current?.(nextTrack, { resumeAt: 0, playbackScenario: QUEUE_AUTO_ADVANCE })`
- Next track object already contains resolved `src` from `albumTracksForPlayback` / `playQueue` build.
- **Latency win:** auto-advance skips API TTFB + 302 on each track when `src` is direct CDN.

---

## 4. Resume

**File:** `resumeInternal` (~L2410)

- Calls `audio.play()` on **existing** `audio.src` — does not re-resolve preview URL.
- Entitled path may background-refresh stream via `fetchLibraryStream` if signed URL stale — **preview CDN unaffected**.
- Guest resume on direct CDN: **same element, no redirect**.

---

## 5. Queue construction sites

| Site | Builder | Preview in queue? |
|------|---------|-------------------|
| `AlbumTracklistSheet` | `albumTracksForPlayback` → `playableReleaseQueue` | Guest: preview `src` per track |
| `page.js` album modal | `albumTracksForPlayback` | Same |
| `ReleaseCardPlayButton` | `playQueue([track], 0)` | Single-item queue |
| Library playlists | `toPlaybackTrack` | Usually stream |

`filterPlayableQueueItems` / `isQueueTrackPlayable` check `track.src` OR `preview_path` — not API hostname.

---

## 6. `getTrackPreviewSrc` interaction (stream fallback / entitled edge)

Used inside `playTrackInternal` when:

- Guest entitled mismatch uses preview instead of stream
- Stream fetch 401/404/403 → preview fallback

Re-resolves from `preview_path` via `catalogPreviewAudioUrl` — **will pick up direct CDN after resolver change**. Not queue-specific.

**Guard:** `isFlatPreviewCdnSrc` rejects **flat** `previews/{file}-preview.ext` CDN URLs. **Nested** canonical keys (`previews/singles/{slug}/…`) **do not match** the flat regex — safe for class **B** keys.

---

## Dependency diagram

```
albumTracksForPlayback / toPlaybackTrack
        │
        ▼
resolvePlaybackSrc → catalogPreviewAudioUrl  ← activation point
        │
        ▼
track.src (API URL today → CDN URL after activation)
        │
        ▼
setQueue → playNext / playPrevious / onEnded auto-advance / resume
```

**Conclusion:** Queue subsystem is **URL-agnostic**. Replacing API URL with CDN URL in `track.src` is safe provided resolver + fallback (B1–B3) are correct.
