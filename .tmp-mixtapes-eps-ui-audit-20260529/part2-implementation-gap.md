# Part 2 — Implementation status vs prompt

**Session mode:** audit only (no `src/` edits). `npm run build` not run.

## Prompt requirements checklist

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Rename storefront "Albums & EPs" → "Albums" | **Done** — UI already says "Albums" (`page.js` ~2030, 2136) |
| 2 | Add "Mixtapes & EPs" section under Albums | **Not done** |
| 3 | Section shows love-hz-vol-1, ad, tbh | **Partial** — all three under Albums via `CatalogGrid` |
| 4 | Clone Singles UI (cards, sizes, carousel, modal, play) | **Not done** — uses `CatalogGrid` + `AlbumModal` |
| 5 | My Music: Mixtapes category (ad, tbh) | **Not done** |
| 6 | My Music: EPs category (love-hz-vol-1) | **Not done** |
| 7 | `release_type` / slug `mixtapes-and-eps` (not recategorized as albums) | **Backend yes** / **storefront inline `type:"album"`** |
| 8 | Audio paths + trackSlug stream | **Backend yes** / **UI tracklists stale** |
| 9 | `npm run build` passes after changes | **N/A** (no changes) |

## Suggested implementation touchpoints (for a follow-up build)

1. **`canonical-catalog.js`**
   - Split `CANONICAL_ALBUMS` vs `CANONICAL_MIXTAPES_AND_EPS` (or filter by `release_type`).
   - Add `getStorefrontMixtapesAndEps()` mirroring `getStorefrontAlbums()` with canonical `tracks[]` objects (not string titles).

2. **`page.js`**
   - Hydrate `displayMixtapesAndEps` from canonical helper (like singles catalog fetch pattern).
   - Insert new home section after Albums with **Latest Singles** card markup (extract shared row component to avoid duplication).
   - Wire Music tab optional sub-section or home-only per prompt.
   - Point `catalogPlaybackLookup` at canonical track objects for the three slugs.
   - Replace `INLINE_ALBUMS` mixtape rows or remove them from `albums` array so Albums section can be empty or future true albums only.

3. **`MyMusicTab.js` + `useMusicLibrary.js` + `partitionLibraryByType`**
   - Partition owned library by `release_category` / `metadata.release_type`: Mixtape vs EP vs Album.
   - Render two new sections under Purchased / Owned.

4. **Modal / play**
   - Either reuse `openSingleModal` per release (if cloning Singles exactly) or keep `AlbumModal` but feed `tracks` from `getCanonicalTracksForAlbum`.
   - Ensure `playAlbumTracks` receives objects with `slug` + `trackSlug`, not display strings only.

5. **Do not change** `AudioContext` / `resolvePlaybackSrc` contract — already correct for `slug` + `trackSlug`.

## Risk notes

- `page.js` is guardrail-protected; scoped edits only for music sections per user approval.
- Inline `love-hz` slug vs `love-hz-vol-1` can break entitlement/product lookup if alias not applied on cart slug.
- Some R2 track folders empty per prior validation (e.g. `01-roll-call`, `09-hour-glass`) — UI can be correct while stream 404s until uploads land.
