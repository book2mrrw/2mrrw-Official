# Part 1 — Storefront & My Music Tab (read-only audit)

## 1. Home tab storefront — section render order

| # | Section label | Component / pattern | File |
|---|---------------|---------------------|------|
| 1 | (actions) Donate / Subscribe | inline buttons | `src/app/page.js` |
| 2 | Latest Singles | horizontal scroll cards + `<video data-single-carousel>` | `src/app/page.js` (~1810–1971) |
| 3 | Features | `FeaturesRail` | `src/components/home/FeaturesRail.js` |
| 4 | 2MRRW RADIO | `RadioCarousel` + `FlowState` | `src/components/home/RadioCarousel.js`, `FlowState` in page |
| 5 | — divider — | | |
| 6 | **Albums** | `CatalogGrid` `type="albums"` | `src/components/home/CatalogGrid.js` |
| 7 | Audio Visuals | `AudioVisualsSection` (memo in page) | `src/app/page.js` |
| 8 | Shop | `CatalogGrid` `type="products"` | `CatalogGrid.js` |
| 9 | Vault | placeholder panel | `src/app/page.js` |
| 10 | Collector's Cards | CTA → `/collectors-cards` | `src/app/page.js` |
| 11 | Shows & Events | inline list | `src/app/page.js` |

**Missing vs prompt:** no **Mixtapes & EPs** section; no separate **Albums** (studio albums only) — all three target releases render under **Albums**.

Data source for Albums grid: module-level `const albums` / `INLINE_ALBUMS` in `page.js` (not `getStorefrontAlbums()` from canonical catalog).

---

## 2. Singles reference UI (clone target for Part 2)

### Home — “Latest Singles” (recommended clone target for new section)

- **Layout:** `display:flex` horizontal row, `overflowX:auto`, `scrollSnapType:x mandatory`
- **Card width:** 160px mobile / 200px desktop
- **Card chrome:** `#0a0a0a` bg, 14px radius, `#1a1a1a` border, hover cyan glow
- **Media:** looping muted `<video>` + poster; `data-single-carousel` for in-view autoplay
- **Actions:** `ReleaseCardActions` in card footer
- **Click:** `openSingleModal` → `ImmersivePreviewModal` (single)
- **Play path:** `playCanonicalCatalogItem` / `resolvePlaybackSrc` via enriched single slug

### Music tab — “Singles” (different pattern)

- **Component:** `CarouselUI` — one large hero card + prev/next, not a multi-card row
- **Modal:** same `openSingleModal` / `ImmersivePreviewModal`
- **File:** `src/components/home/CarouselUI.js`

Part 2 says “clone Singles section UI exactly” — on the **home** storefront that maps to the **Latest Singles** row (cards 160/200), not `CarouselUI`.

---

## 3. Current mixtape/EP UI (all three releases today)

| Aspect | Actual behavior |
|--------|-----------------|
| Section | **Albums** only (`#home-albums`, Music tab `albums` sub-tab) |
| Card component | `CatalogGrid` — image `CoverArt`, not video cards |
| Mobile card width | 160px (same width as Singles cards, different layout: snap row vs grid) |
| Desktop layout | `grid repeat(auto-fit, minmax(260px, 1fr))` — **not** Singles row |
| Modal | `AlbumModal` in `ImmersivePreviewModal.js` via `openAlbumModal` |
| Play on card open | `playAlbumTracks` → queue with `slug` = **release slug**, `trackSlug` in metadata |
| Tracklist in modal | `normalizeAlbumTracksForModal` — string titles from inline `tracks:[]` |

---

## 4. Music tab structure

Sub-tabs (`page.js` ~2106): **Singles** | **Albums** | **Collection**

| Sub-tab | Sections | Components |
|---------|----------|------------|
| singles | Singles | `CarouselUI` |
| singles | Features | `FeaturesRail` |
| albums | Albums | `CatalogGrid` |
| mymusic | My Music Collection | `MyMusicTab` |

Nav group `g-music` subTabs: Singles, Albums, My Music Collection — no Mixtapes/EPs nav item.

---

## 5. My Music Tab categories (render order)

| Section | Component area | File |
|---------|----------------|------|
| Header + sort sheet | inline | `MyMusicTab.js` |
| Continue Listening | conditional block | `MyMusicTab.js` |
| Recently Played | `LibraryCarousel` | `MyMusicTab.js` |
| Recently Added | `RecentlyAddedRow` | `MyMusicTab.js` |
| Streaming Library | `PlaylistSection` + subscription `LibraryCarousel` | `MyMusicTab.js` |
| Purchased / Owned → Owned Singles | `LibraryCarousel` | `MyMusicTab.js` |
| Purchased / Owned → **Owned Albums** | list rows (play album / tracklist) | `MyMusicTab.js` |
| Collector / Vault | `LibraryCarousel` + vault CTA | `MyMusicTab.js` |

**Missing vs prompt:** **Mixtapes** and **EPs** categories. `useMusicLibrary` only exposes `ownedSingles` and `ownedAlbums` (`partitionLibraryByType` in `music-access.js`). EP/mixtape purchases bucket into `ownedAlbums` (`type === "ep"` or `product_type === "album"`).

---

## 6. Release type → display mapping

| Layer | Where defined | Notes |
|-------|---------------|-------|
| R2 folder segment | `RELEASE_TYPE_ALIASES` | `ep`, `mixtape` → `mixtapes-and-eps` |
| Canonical releases | `CANONICAL_ALBUMS` in `canonical-catalog.js` | All three slugs; `release_type` + `release_category` |
| Canonical tracks | `CANONICAL_TRACKS` | `album_slug` + ordered `slug` / `track_number` |
| Storefront inline | `page.js` `const albums` | `type:"album"`, legacy `/images/albums/` paths |
| Storefront API helper | `getStorefrontAlbums()` | **Not wired** into `page.js` |
| DB migration | `20260529150000_canonical_metadata_normalization.sql` | `mixtapes-and-eps/{slug}/{trackSlug}/` paths |

Slug alias: `love-hz` → `love-hz-vol-1` in `CANONICAL_SLUG_ALIASES` (inline still uses `love-hz`).
