# Files changed

| File | Change |
|------|--------|
| `src/lib/playback/resolve-playback-key.js` | `inferProductReleaseType()`; select `product_type`, `preview_path`; features-aware preview folder + legacy preview from DB |

## Unchanged (by design)

- `src/context/AudioContext.js`
- `src/app/page.js` (UI)
- `src/components/home/FeaturesRail.js`
- `src/lib/commerce/entitlements.js` (`feature` already in `isDigitalProduct`)
