# Page Init Findings — Phase 5.2.6

**Scope:** `src/app/page.js` (~2870 lines, 28 `useEffect` hooks). Document only; no risky refactors this phase.

## Ranked findings

| Rank | Finding | Impact on tap→audible | Fix this phase? |
|------|---------|----------------------|-----------------|
| 1 | Monolithic page bundles home + shop + live + vault + checkout | Inflates JS parse/hydration before first play | No — out of scope |
| 2 | Catalog fetch on mount (`/api/catalog/releases`) | Competes with network on cold load | No — required for cards |
| 3 | Home cover `imagePipeline.preload` (18 items) on `activeTab === "home"` | Bandwidth competition with first audio | No — visual priority unchanged |
| 4 | `AppAuthRoot` hydration placeholder (~1 frame) | AudioProvider mounts in layout outside gate — **improved since 5.2.4 audit** | Already mitigated |
| 5 | Singles carousel scroll sync + video play/pause | Main-thread work on scroll; unrelated to audio tap | No |
| 6 | Three URL/session init effects (checkout, tab, deepLink) | Distinct concerns; not duplicated logic | No |
| 7 | Ambient audio refs pause/resync (3 effects) | Runs when tab/engine state changes | No |
| 8 | Live YouTube player destroy on tab leave | Heavy but tab-scoped | No |

## Effect inventory (summary)

| Lines (approx) | Purpose |
|----------------|---------|
| 389 | Audio Visuals IntersectionObserver (YouTube) |
| 757 | Mobile breakpoint |
| 795 | Hero parallax scroll |
| 804 | Home scroll section spy (mobile) |
| 833 | Inventory load |
| 837 | Catalog releases fetch |
| 961 | Home cover preload batch |
| 976 | Singles carousel video sync |
| 1003 | Exclusive drops fetch |
| 1022 | Circle submissions fetch |
| 1039 | Printful shop fetch |
| 1061–1068 | localStorage circle + cart persist |
| 1070 | Live countdown ticker |
| 1087 | Custom cursor (desktop) |
| 1096 | Ambient audio tab routing |
| 1109–1120 | Ambient pause when engine/playback active |
| 1128 | Now playing UI sync |
| 1149 | YouTube player cleanup |
| 1362 | Album modal registration |
| 1440 | Checkout pending URL param |
| 1496–1522 | Mobile nav/cart/stripe modal registry |
| 1577 | Tab / sessionStorage / gift highlight |
| 1626 | Deep link handler |

## Zero-risk duplicate check

- **Checkout vs tab vs deepLink URL parsers:** Separate query keys (`checkout`, `tab`, `deepLink`); merging would increase coupling — **left unchanged**.
- **No duplicate catalog fetch** on mount.
- **No duplicate `refreshAccountState`** in mount effects.

## Recommended follow-up (future phase)

1. Lazy-mount non-home tabs to reduce initial effect count.
2. Defer Printful/shop fetch until `activeTab === "shop"`.
3. iOS dev `dumpPlaybackTiming()` session with prewarm cards scrolled into view vs cold card.
