# Remaining risks

## 1. Album tracks without catalog match (medium)

Inline album rows like `Glass Full` (T.B.H.) have no matching single slug and no album-level `preview` in static data. Guests still get **no** per-track preview until Control System supplies track previews or album preview assets.

**Mitigation:** `albumTracksForPlayback` filters `!src` — no fake URL. Entitled users stream via per-track slug when products exist in Supabase.

## 2. Feature preview WAV size (low)

Feature previews are ~5MB WAV vs ~800KB MP3 singles. Slower start on mobile networks; not a logic bug.

**Mitigation:** Consider MP3 previews in R2 / Control System (media ops, out of scope for this fix).

## 3. No live `browseFeatures` API merge (low)

Singles hydrate from `/api/catalog/releases`; features remain static `INLINE_FEATURES`. Control System feature updates won’t appear until a features fetch is added (same pattern as singles).

## 4. Title alias table is finite (low)

`TITLE_SLUG_ALIASES` in `music-playback.js` covers known cross-album singles (Hour Glass, W.2.D, Artificial, Turnt Me 2 Dis). New overlaps need alias entries or CS track objects with `slug`.

## 5. Album entitled playback for non-product track slugs (low)

Derived slugs like `glass-full` may 404 on `/api/library/stream` if not in `products`. Entitled album play works for album-level product slug fallback path when queue is empty.
