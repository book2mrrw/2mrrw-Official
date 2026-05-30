# Root causes fixed

## F1 — Entitled users heard 30s preview on 403

**Cause:** Commit 97f2439 treated 401 and 403 identically when `canStream` was true, loading preview audio on any stream denial.

**Fix:** Preview fallback only on `401` or `403` when user is **not** entitled (`!canStream`). Entitled `403` surfaces "Stream unavailable — tap to retry".

## F2 — Album tracks 404 on stream

**Cause:** `resolveAlbumTrackPlaybackItem` derived slugs from track titles (e.g. `glass-full`), which do not exist in `products`.

**Fix:** Stream slug is the album's real product slug unless the track has a slug in the catalog lookup map.

## F3 — EP products would 403 for subscribers

**Cause:** `isDigitalProduct` omitted `product_type: "ep"`.

**Fix:** Added `type === "ep"` to the allowlist.

## F4 — Album tracklist silence / EP parity

**Cause:** `albumTracksForPlayback` filtered out tracks with no `src`; EP type not grouped with albums in library partition.

**Fix:** `previewUnavailable` metadata + UI label; queue skips non-playable rows; `ep` treated like `album` in `partitionLibraryByType`.
