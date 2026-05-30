# Risks and inconsistencies (ranked)

## P0 — User-visible playback / access

### 1. Modal in-player restart skips `toPlaybackTrack`

**Where:** `ImmersivePreviewModal.js` ~475–478  
**Issue:** `playTrack({ ...single })` may lack `src` and `metadata.access` that opener supplies via `toPlaybackTrack`.  
**Impact:** Play from modal after pause/switch or wrong track slug can fail or play without preview/full gating.  
**Mitigation direction:** Route modal controls through same `toPlaybackTrack` + accountState as page openers.

### 2. Cover vs play button behavior split (singles/features)

**Where:** `page.js` ~1880; `ReleaseCardPlayButton.js` ~38–58; `FeaturesRail.js` ~22 vs ~48  
**Issue:** Cover → modal + auto-play; ▶ → audio only, no modal.  
**Impact:** Confusing UX; “I pressed play why did the modal not open?” and opposite for cover.  
**Mitigation direction:** Product decision: unify (always open modal on play) or document intentionally.

### 3. Global bar + modal player overlap

**Where:** `layout.js` GlobalAudioPlayerBar; `page.js` ~983–999  
**Issue:** Immersive modal does not hide global dock; only page mini-player is gated.  
**Impact:** Two scrub/play UIs; possible double perception of “active player”.  
**Mitigation direction:** Hide global bar when `modalStack` contains `immersive-preview` or modal open props.

## P1 — Flow / state

### 4. Album: three entry paths

**Where:** `CatalogGrid.js` ~86 vs ~140–142; `openAlbumModal` ~1156–1162  
**Issue:** Cover plays immediately + modal; card play opens sheet only; modal has its own play buttons.  
**Impact:** Unexpected auto-play on browse; sheet vs modal duplication.  

### 5. `authLoading` deferred play race

**Where:** `page.js` ~1106–1108, ~951–981, refs ~602–603  
**Issue:** Slug refs replay when auth ready; switching selection before resolve may play wrong item if refs not aligned.  
**Impact:** Wrong track on first listen after fast navigation.  

### 6. `openSingleModal` depends on `nowPlaying` but unused

**Where:** ~1115 dependency array  
**Issue:** Stale pattern; unnecessary callback churn.  
**Impact:** Low; maintenance noise.

## P2 — Architecture / consistency

### 7. Album modal not on `ModalShell` / stack

**Where:** `page.js` ~1577–1688 vs `ModalShell`  
**Issue:** Separate z-index (8888), animation, no shared immersive palette.  
**Impact:** Inconsistent dismiss/scroll lock (does register `album-modal` ~1185–1188).  

### 8. `playQueue` vs `playTrack` on cards vs modal open

**Where:** ReleaseCardPlayButton uses `playQueue`; openers use `playTrack`  
**Issue:** Queue index/side effects may differ for single-item play.  
**Impact:** Usually equivalent for one track; edge cases if queue not cleared.

### 9. Preview upgrade timer only on card play

**Where:** `ReleaseCardPlayButton.js` ~59–64  
**Issue:** `upgradeToFullStream` after 2s not triggered by modal open path.  
**Impact:** Subscriber entitled to full may stay on preview longer when entering via modal only.

### 10. Radio has play but no preview modal

**Where:** `RadioCarousel.js` ~119–124  
**Issue:** By design; no deep link to immersive experience from radio hero.  
**Impact:** Inconsistent discovery path vs singles row.

## P3 — Technical debt

### 11. Deprecated `ModalAudioPlayer` / `ModalPlayerShell`

Still in tree; comments point to AudioContext—risk of accidental reuse.

### 12. Static `tracks` as strings on albums

**Where:** `page.js` albums ~203–207  
**Issue:** `albumTracksForPlayback` synthesizes slugs; per-track entitlement may be coarse (album-level).  
**Impact:** Access resolution per row in sheet uses `${album.slug}-t${index}` (~248).

---

## Summary table

| # | Severity | Topic |
|---|----------|-------|
| 1 | P0 | Modal `playTrack` without `toPlaybackTrack` |
| 2 | P0 | Cover auto-play vs button inline play |
| 3 | P0 | Dual global + modal chrome |
| 4 | P1 | Album triple path |
| 5 | P1 | Auth defer race |
| 6 | P2 | Unused dep `nowPlaying` |
| 7 | P2 | Album modal separate shell |
| 8 | P2 | playQueue vs playTrack |
| 9 | P2 | upgradeToFullStream only on cards |
| 10 | P3 | Radio no immersive modal |
| 11 | P3 | Deprecated modal player files |
| 12 | P3 | String-only album tracks |
