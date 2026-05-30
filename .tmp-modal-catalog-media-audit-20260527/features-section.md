# Features section

## Data

| Symbol | Location | Role |
|--------|----------|------|
| `features` | `app/page.js` ~146–149 | Two features: `i-dont-believe-you`, `2-heavy` |
| `INLINE_FEATURES` | ~211 | Alias; merged in slug map ~757 |

Each feature: `type: "feature"`, `featuring`, `cover`, `preview` (wav), `price`, `hasCs: false`.

## `FeaturesRail.js`

| Concern | Line ref | Detail |
|---------|----------|--------|
| Cover click | ~19–29 | `onOpenFeature?.(feat)` — keyboard accessible |
| Play row | ~45–63 | `ReleaseCardActions` without custom `onPlayClick` |
| Entitlement | ~13–14 | `resolveContentAccess`, `itemHasPlayableAudio` |
| Cart | ~55 | `stopPropagation` on action row ~45 |

**Cover → modal + play** (via `openFeatureModal` in parent).  
**▶ → inline play only** (`playQueue`), same pattern as singles.

## page.js integration

| Surface | Line ref | Handler |
|---------|----------|---------|
| Home Features | ~2006 | `onOpenFeature={openFeatureModal}` |
| Music sub-tab | ~2157 | Same |

### `openFeatureModal` (~1117–1145)

1. Clears `nowPlaying`, closes single modal if open (~1119–1124)
2. Sets `featureModalItem`, `featureModalOpen`
3. `toPlaybackTrack(feat, accountState, "feature_modal")` → `playTrack` if `src`
4. If `authLoading`, sets `featureModalPlaySlugRef` and returns early
5. Fetches `getControlSystemReleaseDetail` → `featureReleaseDetail`

### Render (~1557–1571)

Same `ImmersivePreviewModal` as singles with `featureModalAccess` from `resolveContentAccess(featureModalItem)`.

### Close (~1148–1153)

`closeFeatureModal` clears state and **`pause()`**.

## Deep link

`?deepLink=feature:slug` ~1475–1479 → `openFeatureModal` (switches to singles tab).

## vs Singles

| Aspect | Singles | Features |
|--------|---------|----------|
| Modal component | ImmersivePreviewModal | Same |
| Open handler | `openSingleModal` | `openFeatureModal` |
| play source tag | `preview_modal` | `feature_modal` |
| Visual | Video on card | Static CoverArt |
| Mutual exclusion | Feature open closes single modal | Single open closes feature modal |
