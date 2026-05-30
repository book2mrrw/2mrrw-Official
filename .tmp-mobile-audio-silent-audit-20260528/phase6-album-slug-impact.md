# Phase 6 — Album Slug Fix Impact (F2)

File: `src/lib/music-playback.js`
- `normalizeCatalogItemForPlayback` is at `L37-L50`; mainly normalizes preview fields and slug from title.
- `toPlaybackTrack` is at `L148-L193`; computes playback src via `resolvePlaybackSrc(normalized, access, { userId })` at `L168`.
- Album-specific slug logic is isolated in `resolveAlbumTrackStreamSlug` / `resolveAlbumTrackPlaybackItem` (`L100-L146`).

Assessment:
- No direct evidence that F2 changed single/feature slug behavior in `toPlaybackTrack` for non-album items.
- Shared playback source resolution is still centralized in `resolvePlaybackSrc` (`L168`), but this file alone does not show a singles/features regression introduced by album slug mapping.
- Regression likelihood from F2 touching singles/features: **Low / Unproven** from code inspection here.
