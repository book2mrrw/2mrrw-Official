# Tabs and navigation map

**Source:** `src/app/page.js` (primary shell), mobile nav `MOBILE_NAV_TABS` lines 55–63.

## Top-level navigation

### Mobile bottom bar (`MOBILE_NAV_TABS`)

| Tab id | Label | Renders | State / notes |
|--------|-------|---------|---------------|
| `home` | Home | Cinematic hero, radio carousel, features rail, vault/cards sections on scroll | `activeTab === "home"`; `homeScrollSection` for sub-highlight |
| `singles` | Music | Sub-nav → Singles grid | Grouped with `albums` / `mymusic` under “Music” area (2085+) |
| `mymusic` | Collection | `MyMusicTab` component | Fetches library via AuthContext; `playTrack` / `playQueue` |
| `vault` | Vault | `VaultUnlockedRoom` or locked state | Entitlement-gated |
| `cards` | Cards | Collector cards section | Links to collectors flow |
| `shop` | Shop | Merch grid | `activeTab === "shop"` |
| `more` | More | Opens mobile nav sheet (not a content tab) | `mobileNavOpen` |

### Desktop sidebar groups (`navGroups` ~1533–1545)

| Group | directTab / subTabs |
|-------|---------------------|
| HOME | `home` |
| MUSIC | `singles`, `albums`, `mymusic` |
| SHOP | `shop` |
| CARDS | `cards` |
| VAULT | `vault` |
| SHOWS & EVENTS | `shows` |
| MORE | `blog`, `vision`, `circle`, `innercircle`, `live`, `help` |
| (footer) | `account` |

## Content tabs (what renders when `activeTab` matches)

| Tab id | Section | Main components | Fetch on mount |
|--------|---------|-----------------|----------------|
| `home` | Hero video, `RadioCarousel`, `FeaturesRail`, scroll sections | Catalog data mostly static in page; control-system release detail on modal open | Deep link / account via AuthContext |
| `singles` | `CatalogGrid` type singles | `ReleaseCardPlayButton`, card → `openSingleModal` | Account state refresh via auth |
| `albums` | `CatalogGrid` type albums | `openAlbumModal`, `AlbumTracklistSheet` | Same |
| `mymusic` | `MyMusicTab` | Owned library, playlists, continue listening | `refreshLibrary`, `refreshAccountState` on library change |
| `shop` | Merch catalog | Add to cart | Product fetch if dynamic (verify per item source in page) |
| `vault` | `VaultUnlockedRoom` | Vault content | Entitlement from `accountState` |
| `shows` | Events list | Ticket modal | Static `events` array in page |
| `live` | `LivePanel` | Live stream UI | Panel-internal fetch |
| `blog` | Blog posts section | Static / CMS | — |
| `vision` | Vision copy | Static | — |
| `circle` | Community Q&A | `circleSubmissions` state | — |
| `innercircle` | Premium posts | `innerCirclePosts` | — |
| `help` | `HelpSupportSection` | Support form | — |
| `account` | Account profile | See below | `currentUser` from AuthContext |
| `cards` | Collector cards | Card grid | — |

## My Account tab (`activeTab === "account"`) — elements & data

**Lines:** `page.js` 2395–2414.

Rendered when `currentUser` is truthy:

- **Profile card:** initial (`accountDisplayInitial`), name (`accountDisplayName`), email (`currentUser.email`)
- **Status badge:** `userStatus.label` / color from membership state
- **Stats grid:** `myPurchases.length`, circle submission count, hardcoded “Member Since” 2026
- **Quick links:** buttons → `mymusic`, `vault`, `circle`, `innercircle`
- **Admin-only:** `GiftsSentSection`, `CollectorCardAdminPanel` (`accountState`)
- **Sign out:** `handleSignOut`

Data fields accessed: `currentUser`, `accountState`, `myPurchases`, `circleSubmissions`, `userStatus`, `isAdmin`.

Loading state shown when `!currentUser`.

## More tab (mobile)

Opens **mobile nav sheet** (`mobileNavSheetOpen`) listing desktop sidebar groups — not a separate `activeTab` content pane. Sub-items call `switchTab(st.id)`.

## Audio state on tab switch

- **`GlobalAudioPlayerBar`** is mounted in **root layout** (`layout.js` 48), outside `page.js` tab content → **persists across all tabs**.
- **`AudioContext`** wraps entire app in layout → **no reset** on `activeTab` change.
- **Tab-specific behavior:**
  - `activeTab === "live"` effect pauses ambient hero behavior (1003–1006).
  - Home-only video carousel observers when `activeTab !== "home"` (661+).
  - Ambient tab audio paths keyed by `activeTab` when `soundOn` (952–958).
- **Modals:** closing single/feature modal calls `pause()` (`closeSingleModal`, `closeFeatureModal`); album modal close also `pause()`.

## Error boundaries per tab

| Surface | Boundary |
|---------|------------|
| App shell | `MediaErrorBoundary` in `layout.js` |
| Preview / feature / album modals | `ModalErrorBoundary` (`page.js` 1573–1645) |
| Mobile nav / cart sheets | `ModalErrorBoundary` |
| Main tab content | **No** per-tab ErrorBoundary — relies on layout boundary |

## Global players vs page `nowPlaying`

- **Canonical engine:** `AudioContext` + `GlobalAudioPlayerBar` (mobile compact dock).
- **Legacy/desktop strip:** `page.js` `nowPlaying` state + bottom bar (2423–2441) — separate from `GlobalAudioPlayerBar`; may coexist on desktop when `nowPlaying` set. Mobile uses `GlobalAudioPlayerBar` when `hasStarted` (AudioContext), not only `nowPlaying`.
