# Design Language Preservation

Vocabulary for keeping the **2MRRW cinematic identity** stable during feature work. Complements [`../foundation/FRONTEND_ARCHITECTURAL_GUARDRAILS.md`](../foundation/FRONTEND_ARCHITECTURAL_GUARDRAILS.md) — not a redesign guide.

## Core identity (GLYPHS / brand)

- **Wordmark:** `2MRRW` — heavy weight (900), wide letter-spacing on hero, pulse glow
- **Palette:** black base, cyan accent (`#00ffff`), purple secondary (`#a259ff`), subtle gradients on panels
- **Atmosphere:** dark cinematic shell, light text, thin borders `rgba(0,255,255,0.12)`

## Typography

| Use | Style |
|-----|-------|
| Section labels | Uppercase, wide `letterSpacing`, small size (~11px), muted `#555` |
| Titles | Heavy weight, tight negative tracking on large headings |
| Body | 13–15px, high contrast on `#111` / black backgrounds |

Do not introduce new font families without explicit user approval.

## Motion (framer-motion)

- `AnimatePresence` for modals and tab content
- Layout transitions on cart and panels — preserve timing feel
- **`useReducedMotion`** must remain — respect `prefers-reduced-motion`
- Hero mobile: short cubic-bezier scroll compression — do not replace with unrelated CSS animation frameworks

## Video / cinematic

- `data-cinematic-video="true"` on motion artwork
- Muted autoplay; fallback to still on error
- `videoPreload="metadata"` on grids — avoid preload storms

## Components (shimmer / CTAs)

- Subscribe: `subscribe-shimmer-button` classes on `/subscribe` and in-page CTAs
- Checkout primary: cyan fill on black (`#00ffff` on `#000`) in mobile cart; desktop modal uses existing button styles

## Modals

- Dark overlay, rounded corners (≈14–20px), gradient panel backgrounds matching notification center
- Stripe Elements embedded without restyling Stripe internals aggressively

## What requires explicit UI approval

- Changing section order in `page.js`
- Replacing framer-motion with CSS-only system
- Global retheme (new primary colors)
- Nav model changes (tabs → different IA)
- Removing pulse / hero branding

## Safe changes (no redesign approval)

- Copy fixes in scoped module
- API-driven labels (vault pricing strings from server)
- Accessibility: contrast fix with same hue family
- Backend-only changes with no visual diff

## Verification

- Side-by-side with `recovery-anchor.json` → `deploymentUrl`
- [`VISUAL_CHECKPOINT_WORKFLOW.md`](VISUAL_CHECKPOINT_WORKFLOW.md)
- `npm run check:frontend-guardrails` for cinematic markers in `page.js`
