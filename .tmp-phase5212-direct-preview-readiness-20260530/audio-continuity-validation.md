# Audio Continuity Validation — Play / Pause / Seek / Skip / Advance

**Section result: PASS** (one **LOW** heuristic note for entitled preview-fallback error path)

---

## Single `<audio>` element model

Platform uses one global audio element in `AudioContext`. Direct CDN changes **only the URL assigned to `src`** — not element lifecycle, WebAudio graph, or command dispatch.

---

## Operations matrix

| Operation | Implementation | Redirect-dependent? | Direct CDN impact |
|-----------|----------------|---------------------|-------------------|
| **Play (tap)** | `playTrackInternal` → `loadAudioSrcAndPlay` / stream resolve | No | **Faster** — skips API TTFB + 302 |
| **Pause** | `pauseInternal` → `audio.pause()` | No | None |
| **Resume** | `resumeInternal` → `audio.play()` on existing src | No | None |
| **Seek** | `seekInternal` — preview capped if `previewOnly` | No | Same cap logic |
| **Skip next** | `playNextInternal` | No | Uses queued `src` |
| **Skip previous** | `playPreviousInternal` | No | Same |
| **Auto-advance** | `onEnded` → next queue track | No | Faster track-to-track |
| **Cross-track (album queue)** | `playQueue` / tracklist | No | Per-track `src` from resolver |
| **Stream → preview fallback** | `getTrackPreviewSrc` on 401/404/403 | No hop dep. | Uses resolver output |
| **CS mode toggle** | `applyCSModeToTrack` | No | Separate CS `src` |
| **Offline playback** | `getOfflinePlaybackUrl` in `resolvePlaybackSrc` | No | Takes precedence when entitled |

---

## `playTrackInternal` src selection

```1635:1652:src/context/AudioContext.js
const streamSlug = parseStreamSlugFromSrc(nextTrack.src) || nextTrack.slug;
const usesLibraryStream = isLibraryStreamSrc(nextTrack.src);
const previewSrc = getTrackPreviewSrc(nextTrack);
let syncSrc = nextTrack.src;
if (usesLibraryStream && streamSlug) {
  const entitledFullStream = Boolean(nextTrack.metadata?.access?.canStream);
  if (previewSrc && !entitledFullStream) {
    syncSrc = previewSrc;
  } else if (redirectFastPath) { ... }
}
```

- Guest: `nextTrack.src` already equals preview URL (API or future CDN).
- Entitled: stream path unchanged.

---

## Preview-only duration cap

`seekInternal` caps position when `track.metadata.access.previewOnly` — **independent of URL shape**.

---

## Error handling — heuristic note (LOW)

```1374:1379:src/context/AudioContext.js
const onPreviewPlayback =
  Boolean(previewFallbackSrc) &&
  (!track?.metadata?.access?.canStream ||
    stateRef.current.source === "preview" ||
    stateRef.current.playbackState === "preview_fallback" ||
    (audio.currentSrc || audio.src || "").includes("/api/media/preview"));
```

| Case | Behavior with direct CDN |
|------|--------------------------|
| Guest preview error | `!canStream` → **onPreviewPlayback true** → "Preview unavailable" ✅ |
| Entitled fallback to preview | Relies on `source === "preview"` or `preview_fallback` — **not** API substring |

**Remediation (implementation QA):** Ensure fallback path sets `source: "preview"` / `playbackState: "preview_fallback"` (already done in stream-denied fallback ~L1336). No blocker for guest-primary activation.

---

## `isFlatPreviewCdnSrc` guard

```325:345:src/context/AudioContext.js
function isFlatPreviewCdnSrc(src) {
  return /\/previews\/[^/]+-preview\.(wav|mp3|...)/i.test(String(src));
}
```

| URL shape | Guard |
|-----------|-------|
| `.../previews/singles/hour-glass/hourglass-preview.mp3` | **Allowed** (nested) |
| `.../previews/hourglass-preview.mp3` | **Rejected** (flat — 404 risk) |

**Activation must not emit flat CDN keys** (blocker B2).

---

## Interruption / visibility

- `skipPauseInterruptionRef`, online reconnect, AirPods/OS takeover — unchanged.
- Preview ended event (`dispatchPreviewEnded`) — slug-based, unchanged.

---

## Verdict

**PASS** — Audio continuity safe for partial direct CDN. Implement B2 + verify entitled fallback sets preview source flags during QA.
