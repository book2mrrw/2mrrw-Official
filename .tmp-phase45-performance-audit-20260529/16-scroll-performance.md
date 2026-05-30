# 16 — Scroll Performance (Nested Scroll, Momentum)

## Scroll containers

### Primary vertical scroller

**File:** `src/app/page.js` L1771–1773
```javascript
ref={mainScrollRef}
style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch" }}
```

- Contains entire tab content + hero
- Scroll listener updates React state (`setHeroScrollY`) — **main thread coupling**

### Horizontal carousels (nested)

| Component | Style | File |
|-----------|-------|------|
| LatestSinglesStyleRow | overflowX auto, scrollSnap | `LatestSinglesStyleRow.js` L40–48 |
| CatalogGrid | overflowX auto | `CatalogGrid.js` L25 |
| FeaturesRail | overflowX auto | `FeaturesRail.js` L10 |
| Mixtapes row | CSS class `.mixtapes-eps-row` | `page.js` L2680 |

**Mobile CSS override** (page.js L2680):
```css
.singles-row,...{ overflow-x:auto!important; -webkit-overflow-scrolling:touch!important; scroll-snap-type:x mandatory!important; }
```

### Modal / sheet scrollers

- `ImmersivePreviewModal.js` L681, L981 — `overflowY: auto`, `overscrollBehavior: contain`
- `AlbumTracklistSheet.js` L263
- Mobile nav sheets L2562, L2656 — maxHeight 80–82vh + overflowY auto

## Nested scroll interaction

Vertical main + horizontal carousels — standard pattern.  
`overscrollBehaviorX: contain` on horizontals — prevents scroll chaining (good).

## IntersectionObserver usage

**Home section nav** (page.js L678–691): observes vault/cards/shows sections — passive, efficient.

**Video sync** uses getBoundingClientRect on scroll — not IO-based.

## Momentum / passive listeners

- Main scroll: `{ passive: true }` (L661) — good
- Horizontal rows: native touch momentum via `-webkit-overflow-scrolling: touch`

## Findings

1. **Scroll → setState on vertical scroller** — defeats passive listener benefit for React work.
2. **Nested scroll regions well-configured** with overscroll containment.
3. **framer-motion hero height transition** on scroll (L1781) — style recalc during scroll.
4. **Modal overscrollBehavior: contain** — prevents background scroll bleed (good).

## Validation checklist

- [ ] FPS during fast vertical fling on Home (audio playing vs not)
- [ ] Horizontal carousel: verify no vertical scroll jank when at scroll snap points
- [ ] `will-change` audit — not widely used (neutral)
