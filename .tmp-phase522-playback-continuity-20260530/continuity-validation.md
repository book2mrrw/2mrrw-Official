# Continuity Validation — Route, Background, Lockscreen

---

## Single audio element

Browser CDP on production: `document.querySelectorAll('audio').length === 1`  
**PASS** — aligns with platform guardrail (no second `<audio>`).

---

## Route / tab transitions

| Transition | AudioProvider | Playback |
|------------|---------------|----------|
| Home → Music tab (mobile nav) | Stays mounted in `layout.js` | Not interrupted by tab switch (code + browser nav test) |
| Storefront scroll / section change | Same page, no remount | **PASS** |
| `AlbumTracklistSheet` open/close | Sheet unmounts; AudioContext persists | `playAndClose` closes sheet, does **not** pause — **PASS** |
| Album detail modal close | `closeAlbumModal` calls `pause()` | **FAIL** — interrupts playback (D-522-002) |
| Single preview modal close | `closeSingleModal` calls `pause()` | **FAIL** — same pattern (D-522-002) |

`GlobalAudioPlayerBar` remains in layout during navigation. Now-playing visibility gated by modal state in `page.js` (~1128) — UI may hide bar during modals without stopping audio (except explicit `pause()` on modal close).

---

## Background / foreground

AudioContext visibility handler (~2701–2829):

| Event | Behavior |
|-------|----------|
| `visibilitychange` → hidden | Saves `wasPlayingBeforeHideRef`, persists position |
| `visibilitychange` → visible | Resumes if was playing; rehydrates MediaSession |
| `pageshow` (bfcache) | Rehydrates MediaSession from state or persisted track |
| `pagehide` / `beforeunload` | Persists MediaSession track + playback position |

**PASS** (code review — not device-tested for screen lock)

---

## Lockscreen / MediaSession

Handlers registered (~2636–2699):

- `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`, `seekbackward`, `seekforward`, `stop`, `togglemicrophone` (CS mode)

`updateMediaSession` (~645):

- Sets `MediaMetadata` title, artist, album, artwork
- `setPositionState` for scrubber
- Persists to sessionStorage via `persistMediaSessionTrack`

| Check | Singles | Album tracks |
|-------|---------|--------------|
| Metadata updates on track change | **PASS** (expected) | **FAIL** — title always release name (D-522-001) |
| Artwork | Cover URL resolved | Release cover — **PASS** |
| Play/pause actions | Wired to resume/pause | **PASS** |
| Next/prev in queue | Wired to playNext/playPrevious | **PASS** |
| Rehydrate after foreground | `rehydrateMediaSession` | **PASS** (structure) |

---

## Queue persistence across navigation

In-session: queue held in `queueRef` while `AudioProvider` mounted — **PASS**

Hard reload: queue not restored automatically; position may restore per slug via listening history — acceptable for current architecture.

---

## Audiovisual (validate only)

Not modified. Cinematic shell, `data-cinematic-video`, ambient audio ducking when `isPlaying` (~1120) reviewed — no changes in scope. **PASS** (no regression in audited paths).

---

## Verdict

| Area | Status |
|------|--------|
| SPA navigation / tab switch | **PASS** |
| Tracklist sheet close | **PASS** |
| Album/single modal close | **FAIL** (pause) |
| Background handlers | **PASS** (code) |
| MediaSession controls | **PASS** |
| MediaSession metadata (multi-track) | **FAIL** |
