# Visual Checkpoint Workflow

Capture **known-good UI state** before risky work and compare after. Complements automated verify — does not replace `npm run verify:foundation`.

## Automated baseline (always run)

```bash
npm run check:frontend-guardrails
npm run test:foundation
```

For PRs touching UI: `npm run verify:foundation`.

## Manual visual checkpoints

### When required

- Any approved `page.js` UI change
- Hero / MP4 / motion tuning
- Mobile shell or cart drawer edits
- Modal choreography changes
- Pre-promotion to `main` / new foundation tag

### Checkpoint surfaces

| Surface | What to verify |
|---------|----------------|
| Hero | MP4 plays, 2MRRW branding, scroll compression on mobile |
| Navigation | Tabs, section scroll, modal triggers |
| Modals | Open/close, overlay, checkout embed |
| Audio | Global bar visible, modal player sync |
| Subscribe | `/subscribe` shimmer CTA, Stripe Elements load |
| Vault | Unlocked room when entitled (test account) |
| Reduced motion | OS prefers-reduced-motion — no seizure-inducing loops |

### Procedure

1. **Before change**
   - `npm run recover:checkpoint` **or** note existing file in `docs/foundation/checkpoints/`
   - Optional: `npm run snapshot:foundation` for full kit zip
   - Screenshot or short screen recording of checklist surfaces (store outside repo if large)

2. **Implement** within scoped module only

3. **After change**
   - `npm run dev` — compare localhost to production alias in `recovery-anchor.json` (`deploymentUrl`)
   - Re-run checklist; note regressions by module name

4. **On regression**
   - Module-only: [`SELECTIVE_RESTORATION_WORKFLOW.md`](SELECTIVE_RESTORATION_WORKFLOW.md)
   - Multi-surface or deps: [`../foundation/CURSOR_RECOVERY_WORKFLOWS.md`](../foundation/CURSOR_RECOVERY_WORKFLOWS.md) Workflow A

## Checkpoint docs (existing)

Foundation checkpoints live at:

```
docs/foundation/checkpoints/checkpoint-*.md
```

Do not duplicate full recovery narrative in checkpoint files — link to `FRONTEND_RECOVERY_PROTOCOL.md`.

## Agent instruction snippet

```
Before UI edits: confirm latest checkpoint or run npm run recover:checkpoint
After UI edits: visual checklist (hero, nav, modals, audio, subscribe)
If regression: selective restore for scoped module before recover:foundation
```
