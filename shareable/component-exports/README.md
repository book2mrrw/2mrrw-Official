# Shareable component exports

Copy-friendly snapshots of preview modal, mobile bottom nav, More sheet, and nav icon components. **Not a runnable package** — use for reference, sharing, or selective restore.

## File map

| Repo source | Export path |
|-----------|-------------|
| `src/components/preview/ImmersivePreviewModal.js` | `shareable/component-exports/ImmersivePreviewModal.js` |
| `src/components/preview/GlyphLyricsPanel.js` | `shareable/component-exports/GlyphLyricsPanel.js` |
| `src/components/preview/PreviewModalPlayer.js` | `shareable/component-exports/PreviewModalPlayer.js` |
| `src/components/preview/releaseMetadata.js` | `shareable/component-exports/releaseMetadata.js` |
| `src/components/collectors-cards/CollectorCardModal.js` | `shareable/component-exports/CollectorCardModal.js` |
| `src/components/nav/MobileNavAnimatedIcon.js` | `shareable/component-exports/MobileNavAnimatedIcon.js` |
| `src/components/nav/VaultNavLockIcon.js` | `shareable/component-exports/VaultNavLockIcon.js` |
| `src/app/page.js` (excerpts only) | `shareable/component-exports/page-mobile-nav-and-more.js` |

## Copy back into the project

Full component files (rows 1–7 above):

```bash
cp shareable/component-exports/ImmersivePreviewModal.js src/components/preview/
cp shareable/component-exports/GlyphLyricsPanel.js src/components/preview/
cp shareable/component-exports/PreviewModalPlayer.js src/components/preview/
cp shareable/component-exports/releaseMetadata.js src/components/preview/
cp shareable/component-exports/CollectorCardModal.js src/components/collectors-cards/
cp shareable/component-exports/MobileNavAnimatedIcon.js src/components/nav/
cp shareable/component-exports/VaultNavLockIcon.js src/components/nav/
```

`page-mobile-nav-and-more.js` is **reference only**. Paste sections into `src/app/page.js` manually; do not replace the whole page file.

Prefer selective restore when recovering from drift: `docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md`.

## Dependencies

### Preview modal stack

| File | Imports / peers |
|------|-----------------|
| `ImmersivePreviewModal.js` | `PreviewModalPlayer`, `GlyphLyricsPanel`, `releaseMetadata`, `@/lib/lrc` (`extractLrcFromRelease`), `framer-motion` |
| `GlyphLyricsPanel.js` | `@/lib/lrc` (`parseLrc`, `getActiveLrcIndex`), `framer-motion` |
| `PreviewModalPlayer.js` | Parent passes `audioRef` (shared modal audio element in `page.js`) |
| `releaseMetadata.js` | No React; used by `ImmersivePreviewModal` |

**CSS** (in `src/app/globals.css`): `.hero-title-glow`, `.song-title-turquoise-glow`, `.preview-credits-heading`, `.preview-sheet-dismiss-handle`, `.preview-drawer-handle`

**Page.js wiring** for preview:

- State: `selectedSingle`, `selectedReleaseDetail`, `isMobile`, `modalAudioRef`
- `getControlSystemReleaseDetail` for `releaseDetail`
- Handlers: `addToCart`, `addVinylToCart`
- Usage block: see `page-mobile-nav-and-more.js` (~1136–1150)

### Collector modal (bonus)

| File | Imports / peers |
|------|-----------------|
| `CollectorCardModal.js` | `./collectorCardCatalog`, `@/lib/collectors-cards/purchase` |

Used from collectors-cards page/components, not `page.js`.

### Mobile nav icons

| File | Imports / peers |
|------|-----------------|
| `MobileNavAnimatedIcon.js` | Tab ids: `home`, `singles`, `shop`, `shows`, `cards` |
| `VaultNavLockIcon.js` | `framer-motion`; used when `tab.vault` in `MOBILE_NAV_TABS` |

### `page.js` context (mobile nav + More)

Imports at top of `page.js`:

```js
import { motion, AnimatePresence } from "framer-motion";
import ImmersivePreviewModal from "@/components/preview/ImmersivePreviewModal";
import { MobileNavAnimatedIcon } from "@/components/nav/MobileNavAnimatedIcon";
import { VaultNavLockIcon } from "@/components/nav/VaultNavLockIcon";
```

Constants / motion presets (same file, near top): `MOBILE_NAV_TABS`, `MOBILE_NAV_MORE_SVG`, `OVERLAY_FADE`, `SHEET_UP`, `SPRING_SOFT`

State & helpers:

- `mobileNavOpen` / `setMobileNavOpen`
- `isMobileNavTabActive`, `switchTab`, `activeTab`, `homeScrollSection`
- `sidebarNav` (~987), `currentUser`, `userStatus`, `soundOn` / `setSoundOn` (More sheet)
- Mobile shell: `isMobile`, cart FAB, `mobileMiniPlayerBottom` (mini player sits above nav)

Excerpt reference: `page-mobile-nav-and-more.js`

## npm / packages (unchanged by exports)

- `framer-motion`
- `react` / `next`
- `@/lib/lrc` for glyph lyrics

Do not bump dependencies when restoring from these copies unless explicitly approved (`PROJECT_GUARDRAILS.md`).
