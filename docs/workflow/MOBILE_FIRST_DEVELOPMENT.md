# Mobile-First Development

Mobile-first **in this project** means: when the user requests mobile work, scope changes to **mobile code paths only** — not a full responsive redesign of the cinematic shell.

## Philosophy

- Desktop cinematic layout is the **foundation baseline** (see [`../foundation/FRONTEND_FOUNDATION_BASELINE.md`](../foundation/FRONTEND_FOUNDATION_BASELINE.md)).
- Mobile UX lives primarily in `page.js` behind `isMobile` and dedicated mobile sections (cart drawer, compressed hero, touch scroll).
- **Mobile-first task** = improve touch, scroll, and small-viewport behavior without altering desktop breakpoints or desktop modal geometry.

## Scope rule

When `mobile-only` is specified:

| Allowed | Forbidden |
|---------|-----------|
| Edit branches where `isMobile === true` | Change desktop-only styles in shared elements |
| Mobile cart / bottom sheets | Rewriting desktop nav or tab bar |
| `mobileHeroHeight`, scroll compression, touch padding | Global color or typography system changes |
| `NotificationCenterPanel` with `isMobile` prop | Subscribe page desktop layout |

## Primary surfaces

- `src/app/page.js` — `{/* ── MOBILE UI ── */}`, mobile cart, hero compression
- `src/components/account/NotificationCenterPanel.js` — grid collapse on mobile
- Secondary pages: test `/subscribe` on narrow viewport; do not redesign unless scoped

## Development checklist

1. Confirm prompt includes `mobile-only: true`
2. Use browser devtools device mode or narrow window — compare to https://artist-platform-silk.vercel.app
3. Verify desktop at 1280px+ unchanged (visual diff or screenshot)
4. `npm run test:foundation` — smoke still passes
5. Optional: `node scripts/check-scoped-changes.mjs` with `SCOPE=mobile`

## Visual checkpoint

Before/after mobile changes, follow [`VISUAL_CHECKPOINT_WORKFLOW.md`](VISUAL_CHECKPOINT_WORKFLOW.md) — capture hero, mobile cart, and one modal.

## Recovery

If mobile change breaks desktop:

1. **Selective:** `git checkout <anchor> -- src/app/page.js` then re-apply mobile-only hunks — [`SELECTIVE_RESTORATION_WORKFLOW.md`](SELECTIVE_RESTORATION_WORKFLOW.md)
2. **Full:** `npm run recover:foundation` when lockfile, deps, or multiple files are corrupted

## Related

- [`FEATURE_ISOLATION.md`](FEATURE_ISOLATION.md) — Mobile Modal module
- [`DESIGN_LANGUAGE_PRESERVATION.md`](DESIGN_LANGUAGE_PRESERVATION.md) — typography and motion vocabulary
