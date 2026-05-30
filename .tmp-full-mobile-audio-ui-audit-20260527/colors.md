# Colors audit

**Audit date:** 2026-05-27  
**Full raw matches:** `.tmp-full-mobile-audio-ui-audit-20260527/raw-colors-grep.txt` (1736 lines)

## Tailwind / theme configuration

- **No `tailwind.config.js`** in repository.
- Tailwind v4 via `@import "tailwindcss"` in `src/app/globals.css`.
- **`@theme inline`** (`globals.css` 10–15): maps `--color-background`, `--color-foreground` from CSS variables.

## CSS variables (`globals.css` `:root` and motion)

| Name | Value | Lines (approx) |
|------|-------|----------------|
| `--background` | `#ffffff` (dark scheme: `#0a0a0a`) | 5–21 |
| `--foreground` | `#171717` (dark: `#ededed`) | 6–20 |
| `--motion-duration-fast` | `0.18s` | `tokens.css` 6 |
| `--motion-duration-base` | `0.34s` | 7 |
| `--motion-duration-slow` | `0.48s` | 8 |
| `--motion-ease-out` | `cubic-bezier(0.33, 0, 0.2, 1)` | 10 |
| `--motion-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | 11 |
| `--motion-ease-spring` | `cubic-bezier(0.22, 1, 0.36, 1)` | 12 |
| `--modal-accent` | `rgb(0, 220, 210)` (registered property) | `globals.css` 174–177 |
| `--modal-accent-glow` | `rgba(0, 220, 210, 0.44)` | 180–183 |
| `--player-accent` / `--player-accent-muted` / `--player-accent-glow` | used in scrub gradients | `globals.css` 2594–2598 |

Immersive modal shell also sets per-modal CSS vars: `--glow`, `--glow-dim`, `--p1`, `--accent` via `ImmersivePreviewModal` `themeVars()` (inline styles).

## Platform brand palette (recurring hardcoded)

| Role | Hex / rgba | Typical usage |
|------|------------|---------------|
| Page background | `#0a0a0a`, `#050506`, `#111`, `#0d0d0d` | body, modals, cards |
| Primary accent (cyan) | `#00ffff`, `rgba(0,255,255,*)` | nav active, player scrub, buttons |
| Secondary (purple) | `#a259ff`, `#c77dff` | badges, gradients |
| Orange accent | `#ff6b35` | tags, highlights |
| Error / cart | `#ff4d4d` | cart badge, errors |
| Muted text | `#555`, `#666`, `#777`, `#999`, `#aaa` | metadata, labels |
| Borders | `#1e1e1e`, `#222`, `#333`, `#141414` | cards, player bar |
| White overlays | `rgba(255,255,255,0.06–0.45)` | borders, secondary text |

## `page.js` inline palette (representative)

- Nav active: `#00ffff` on `rgba(0,255,255,0.055)` background (1730).
- Exclusive badges: `#a259ff`, `#00ffff`, `#ff6b35` (135–136).
- Cart FAB: `#00ffff` fill, `#000` stroke (2475–2477).
- Mobile nav bar: `rgba(6,6,6,0.94)` (2486).

## `ImmersivePreviewModal` theme defaults (`buildTheme`)

| Token | Default |
|-------|---------|
| `dark` | `#0a0a0a` |
| `p1` | `#9b5de5` (from cover palette or fallback) |
| `accent` | `#c77dff` |
| `glow` | `rgba(155,93,229,.6)` |

Cover-driven palette overrides via `useCoverPalette` hook.

## `ReleaseCardPlayButton` inline

- Background `#111`, border `#333`, active `#00ffff` / `rgba(0,255,255,0.5)` (105–106).

## Player bar CSS (`globals.css`)

- Dock background: `rgba(10, 10, 10, 0.97)` (2438).
- Compact scrub fill: `#00ffff` (2603–2606).
- Skip buttons: `rgba(255, 255, 255, 0.55)` (2544).

## Inconsistencies flagged

| Issue | Details | Severity |
|-------|---------|----------|
| Dual cyan systems | Global UI uses `#00ffff`; modal/player tokens use `rgb(0, 220, 210)` / turquoise glow classes | LOW — visually close but not identical |
| Gray scale mix | `#555` vs `rgba(255,255,255,.38)` vs `#666` for same “secondary text” role | INFO |
| Background blacks | `#0a0a0a` vs `#050506` vs `#111` for modal/shell | LOW |
| `layout.js` body | `background: "#0a0a0a"` inline vs CSS `--background` | INFO |

## Hardcoded hex density

Largest concentration: `src/app/page.js` (thousands of inline style color props), `src/app/globals.css`, `ImmersivePreviewModal.js`, subscribe/cart flows.

For exhaustive per-file listing, use `raw-colors-grep.txt`.
