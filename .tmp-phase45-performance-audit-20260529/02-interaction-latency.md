# 02 — Interaction Latency (Tap→UI, Modal, Route, Scroll)

## Methodology

Code-path analysis + existing dev probes (`useModalTiming`, `useGestureTiming`, `useNavTiming` in `src/system/performance/`). No live tap measurements in this audit.

## Tap → UI response

### Play button tap

**Path:** `ReleaseCardPlayButton` / carousel → `playTrack()` → `dispatchPlaybackCommand(PLAY_TRACK)` → `playTrackInternal`

| Stage | File | Est. latency |
|-------|------|--------------|
| Command dispatch | `src/context/AudioContext.js` L2529–2531 | <5 ms |
| Gesture audio unlock | L1366–1377 | 0–50 ms (iOS) |
| Web Audio init (first tap) | L641–690 | 10–80 ms |
| Set src + wait canplay | L117–175, L1638+ | 100–800 ms (network bound) |
| State patch (playing) | L858–859 | 1 frame |

**Optimistic UI:** `patchState` sets `currentTrack` before audio ready — good perceived start if cover art already cached.

### Modal open (single/album/feature)

**Path:** `page.js` state setters → `ImmersivePreviewModal` / `AlbumModal`

- Dev marks: `MARKS.MODAL_OPEN_START/END` in `src/lib/dev/performanceMarks.js`
- `ImmersivePreviewModal.js` — 1,152 lines; backdrop blur animates (`backdropFilter` transition L568–570)
- **Risk:** Modal mount + framer-motion + blur transition = 100–300 ms perceived on mid-tier mobile

### Tab switch (mobile nav)

**Path:** `setActiveTab` in `page.js` — re-renders entire tab content tree inside single component.

- Tab content keyed with `tabKey` + CSS animation `fadeInTab 0.22s` (L1809)
- No route transition — in-memory tab swap (good: no navigation cost)
- **Cost:** Full Page re-render on tab change (bad: large tree)

### Route transitions (satellite pages)

`/subscribe`, `/login` are separate static routes — full page navigation, re-run layout providers (already mounted if client nav via Next Link; hard nav via `window.location.href` at L1805 loses SPA benefit).

## Scroll interaction

### Hero parallax (mobile)

```657:662:src/app/page.js
  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const onScroll = () => setHeroScrollY(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
```

- **Every scroll event → React setState → full Page re-render**
- Drives hero video filter/blur/transform (L1787–1788)
- Passive listener is correct; state update frequency is the bottleneck

### Horizontal carousels

- `LatestSinglesStyleRow.js`, `CatalogGrid.js`, `FeaturesRail.js` — native overflow-x scroll
- `syncSinglesCarouselVideos` pauses off-screen videos (L631–641) — good
- Scroll handler not on horizontal rows — good

## Measurable probes (existing)

| Hook | File | Purpose |
|------|------|---------|
| `useGestureTiming` | `src/system/performance/useGestureTiming.js` | Tap response |
| `useModalTiming` | `src/system/performance/useModalTiming.js` | Modal open |
| `useNavTiming` | `src/system/performance/useNavTiming.js` | Route nav |

All depend on dev-only `perfMark` — not active in production builds.

## Findings

1. **Scroll-linked setState on main vertical scroller** — primary interaction jank source on Home.
2. **Tab switches re-render 2,778-line component** — no memo boundaries at tab level.
3. **Modal blur transitions animate backdrop-filter** — GPU-heavy during open (`ImmersivePreviewModal.js` L568).
4. **Subscribe uses hard navigation** — `window.location.href="/subscribe"` forfeits client cache warmth.

## Validation checklist

- [ ] Chrome Performance: record scroll on Home while audio playing — measure Scripting ms/frame
- [ ] Tap play on cold cache — time to first `playing` event
- [ ] Tap single card → modal visible — frame count to settled blur
