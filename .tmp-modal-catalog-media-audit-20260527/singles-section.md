# Latest Singles section

## Data sources

| Symbol | Location | Role |
|--------|----------|------|
| `singles` | `app/page.js` ~152–201 | Inline catalog fallback (4 singles, video + preview paths) |
| `INLINE_SINGLES` | ~210 | Alias of `singles` |
| `browseSingles` / `displaySingles` | ~588–589, 753 | API merge; UI uses `displaySingles` |
| Catalog fetch | ~691–736 | Merges API page with `INLINE_SINGLES`, `withR2CatalogMedia` |

Static fields per single: `slug`, `cover`, `video` (`/videos/singles/*.mp4`), `preview` (`/audio/previews/*`), `price`, `hasCs`.

## UI components

### Latest Singles row (`page.js` ~1840–1958)

| Behavior | Line ref | Detail |
|----------|----------|--------|
| Card click | ~1880 | `onClick={() => openSingleModal(singleUi)}` — **opens modal + starts playback** |
| Video | ~1911–1928 | Muted loop carousel video; `pointerEvents: "none"` — click hits card |
| Play / cart | ~1935–1948 | `ReleaseCardActions` — play uses `ReleaseCardPlayButton` default (no `onPlayClick`) |
| Entitlement UI | ~1875 | `resolveContentAccess(singleUi, accountState)` for price display |

### `ReleaseCardPlayButton.js`

| Concern | Line ref |
|---------|----------|
| Access | `resolveTrackAccess` ~17–19 |
| Play | `toPlaybackTrack` + `playQueue([track], 0)` ~48–58 |
| Preview preload | ~22–31 |
| Same-track toggle | ~50–55 |
| Preview→full upgrade timer | ~59–64 (`upgradeToFullStream` after 2s) |
| **Does not open modal** | No `onPlayClick` on singles cards |

### `CarouselUI.js` (Music tab hero, ~2154)

| Path | Line ref | Behavior |
|------|----------|----------|
| Cover overlay “Listen/Preview” | ~45–48, 72–74 | `onSingleClick` → `handleSingleClick` → `openSingleModal` |
| Access label | ~14 | `overlayPlayLabel` from `canStream` |
| Wired in page | ~2154 | `onSingleClick={handleSingleClick}` |

### `RadioCarousel.js` (~2009–2044)

| Path | Line ref | Behavior |
|------|----------|----------|
| Play only | ~119–124 | `ReleaseCardPlayButton` `source="home_radio_carousel"` |
| **No modal** | Cover not clickable for modal | |
| Cart | ~125–159 | When `radioAccess?.showCart` |

## Cover tap vs play tap

| Action | Opens modal? | Starts audio? |
|--------|--------------|---------------|
| Single card (home row) | Yes | Yes (`openSingleModal`) |
| CarouselUI cover overlay | Yes | Yes |
| ReleaseCardPlayButton ▶ | No | Yes (`playQueue`) |
| Radio ▶ | No | Yes |

## Related state (`page.js`)

- `modalPlaySlugRef` ~602 — deferred play while `authLoading`
- `singleIndex` / `currentSingle` ~545, 1071 — carousel index (separate from modal `selectedSingle`)
- Deep link `?deepLink=song:slug` ~1463–1468 → `openSingleModal`
