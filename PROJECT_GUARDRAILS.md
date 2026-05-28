# 2MRRW Project Guardrails

**AI development workflow + feature isolation** for artist-platform. This document **integrates with** existing foundation recovery — it does not replace it.

## Canonical recovery (do not duplicate here)

| Resource | Role |
|----------|------|
| [`docs/foundation/recovery-anchor.json`](docs/foundation/recovery-anchor.json) | Single source of truth for anchor commit, tags, dependencies |
| [`docs/foundation/FRONTEND_RECOVERY_PROTOCOL.md`](docs/foundation/FRONTEND_RECOVERY_PROTOCOL.md) | Severity levels, full recovery procedure |
| [`docs/foundation/FRONTEND_LONG_TERM_RECOVERY.md`](docs/foundation/FRONTEND_LONG_TERM_RECOVERY.md) | Long-term safety, npm command matrix |
| [`docs/foundation/CURSOR_RECOVERY_WORKFLOWS.md`](docs/foundation/CURSOR_RECOVERY_WORKFLOWS.md) | Copy-paste Cursor terminal workflows |
| [`docs/foundation/FRONTEND_ARCHITECTURAL_GUARDRAILS.md`](docs/foundation/FRONTEND_ARCHITECTURAL_GUARDRAILS.md) | Sacred surfaces, auth flow, dependency policy |
| [`docs/foundation/BUILD_FRAME_OF_MIND.md`](docs/foundation/BUILD_FRAME_OF_MIND.md) | Mobile-first, audio-native, aesthetic standard for every build session |
| [`scripts/recovery/*`](scripts/recovery/) | Node/shell recovery orchestrators |

### Recovery commands (npm)

```bash
npm run verify:foundation      # guardrails + smoke + lint + build
npm run recover:foundation     # full local restore from anchor
npm run recover:stable         # align frontend-stable-foundation branch
npm run recover:rollback       # production rollback guide
npm run recover:deploy         # gated deploy (--deploy)
npm run snapshot:foundation    # offline recovery zip
npm run recover:checkpoint     # create checkpoint doc
npm run test:foundation        # smoke tests
npm run check:frontend-guardrails
```

**Before rebuilding UI from scratch:** run `npm run recover:foundation -- --dry-run`, then full recovery if needed. Prefer **selective restoration** (see [`docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md`](docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md)).

---

## Protected systems and components

Treat these as **restoration-critical**. Changes require explicit user scope (UI approval where noted).

| System | Primary paths | Protected behavior |
|--------|---------------|-------------------|
| **Hero / cinematic shell** | `src/app/page.js` (hero, backgrounds, section order) | MP4 hero, scroll compression, 2MRRW branding placement, `data-cinematic-video` |
| **2MRRW branding** | `page.js` hero typography, nav identity | Logo pulse, letter-spacing, cyan/purple atmosphere |
| **Navigation** | `page.js` tabs, desktop/mobile nav | Tab model, routing to sections, modal open/close |
| **Subscribe** | `src/app/subscribe/page.js` | Stripe subscription flow, shimmer CTAs, membership copy |
| **Cart** | `page.js` cart state, mobile cart drawer | Add/remove, totals, cart persistence hooks |
| **Checkout** | `CheckoutForm.js`, `page.js` checkout modal, `/api/checkout/*` | Stripe Elements, shipping, success handlers |
| **Auth** | `AuthContext.js`, `middleware.js`, `src/lib/supabase/*` | `/api/account/state` hydration only — no UI entitlement overrides |
| **Playback / audio** | `AudioContext`, `GlobalAudioPlayerBar.js`, `ModalAudioPlayer.js` | Persistent bar, modal player, control-system playback API |
| **Modals** | `page.js` modal shells, `AnimatePresence` | Open/close choreography, overlay stacking, focus traps |
| **Animations** | `framer-motion` in `page.js`, `useReducedMotion` | Layout transitions, presence, reduced-motion guard |
| **Vault** | `VaultUnlockedRoom.jsx`, vault APIs, vault hooks | Entitled room UI; pricing from server, not client fiction |
| **Mobile UX** | `page.js` `isMobile` branches, mobile cart/modals | Touch scroll, hero compression, bottom sheets — mobile-only scope when requested |
| **Recovery systems** | `docs/foundation/*`, `scripts/recovery/*`, `recovery-anchor.json` | Do not weaken verify scripts or move immutable tags without promotion |
| **Notifications** | `NotificationCenterPanel.js` | In-app launch alerts layout |

### Dependency and provider locks

- Exact pins in `package.json` — no `^` / `~` without foundation promotion
- Root providers order: `AuthProvider` → `AudioProvider` → `StripeProvider` in `layout.js`
- Do not bump `next`, `react`, `react-dom`, `framer-motion`, `@supabase/*`, `@stripe/*` without explicit approval

---

## Scoped implementation behavior

1. **Declare scope** in the task: which feature module (see [`docs/workflow/FEATURE_ISOLATION.md`](docs/workflow/FEATURE_ISOLATION.md)) and which files are in bounds.
2. **Default to leaf changes** — new logic in `src/lib/*`, `src/app/api/*`, or leaf components; wire into existing slots in `page.js` only when UI work is approved.
3. **Backend-first** for entitlements — webhook → Supabase → `/api/account/state` → `AuthContext`; never `localStorage` or hardcoded `permissions`.
4. **One feature per branch** — see [`docs/workflow/FEATURE_BRANCH_STRATEGY.md`](docs/workflow/FEATURE_BRANCH_STRATEGY.md).
5. **Verify before merge** — `npm run verify:foundation` when touching `src/app/`, `src/components/`, or `package.json`.

Optional pre-diff warning:

```bash
node scripts/check-scoped-changes.mjs
# or with explicit scope env:
SCOPE="vault" node scripts/check-scoped-changes.mjs
```

---

## Restoration-safe development rules

- **Additive by default** — extend; do not rewrite sacred surfaces.
- **Checkpoints before risky UI** — `npm run recover:checkpoint` or foundation checkpoint docs under `docs/foundation/checkpoints/`.
- **Visual checkpoint workflow** — [`docs/workflow/VISUAL_CHECKPOINT_WORKFLOW.md`](docs/workflow/VISUAL_CHECKPOINT_WORKFLOW.md).
- **Selective restore over full rollback** when only one module regressed — [`docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md`](docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md).
- **No force-push** to `main`, `frontend-stable-foundation`, or immutable foundation tags.
- **Document incidents** in `FRONTEND_FOUNDATION_REPORT.md` after L3+ recovery.

---

## AI modification constraints

Agents and Cursor must:

- Modify **only** systems named in the user request.
- Treat `page.js` as **read-only** unless the user explicitly requests UI work on the cinematic shell.
- Use **mobile-first scope** only when the user specifies mobile — see [`docs/workflow/MOBILE_FIRST_DEVELOPMENT.md`](docs/workflow/MOBILE_FIRST_DEVELOPMENT.md).
- Follow **scoped prompting** — [`docs/workflow/SCOPED_PROMPTING_RULES.md`](docs/workflow/SCOPED_PROMPTING_RULES.md).
- Preserve **design language** — [`docs/workflow/DESIGN_LANGUAGE_PRESERVATION.md`](docs/workflow/DESIGN_LANGUAGE_PRESERVATION.md).
- Apply always-on rules: `.cursor/rules/build-frame-of-mind.mdc`, `.cursor/rules/frontend-foundation.mdc`, `.cursor/rules/platform-architecture.mdc`, `.cursor/rules/project-guardrails.mdc`.

---

## Non-destructive workflow requirements

| Step | Action |
|------|--------|
| 1 | Confirm scope and protected-path impact |
| 2 | Branch from `dev` or `feature/*` (not promotion-only `main` for daily work) |
| 3 | Implement within feature boundary |
| 4 | `npm run check:frontend-guardrails` (+ `check-scoped-changes` if touching protected paths) |
| 5 | `npm run verify:foundation` before PR |
| 6 | If visual regression: selective restore or `recover:foundation` — not uncontrolled rebuild |

---

## Workflow documentation index

| Doc | Purpose |
|-----|---------|
| [`docs/workflow/FEATURE_ISOLATION.md`](docs/workflow/FEATURE_ISOLATION.md) | Modular boundaries (Vault, Mobile, GLYPHS, etc.) |
| [`docs/workflow/FEATURE_BRANCH_STRATEGY.md`](docs/workflow/FEATURE_BRANCH_STRATEGY.md) | Branch naming and promotion |
| [`docs/workflow/SCOPED_PROMPTING_RULES.md`](docs/workflow/SCOPED_PROMPTING_RULES.md) | How to prompt AI safely |
| [`docs/workflow/MOBILE_FIRST_DEVELOPMENT.md`](docs/workflow/MOBILE_FIRST_DEVELOPMENT.md) | Mobile-only scope |
| [`docs/workflow/VISUAL_CHECKPOINT_WORKFLOW.md`](docs/workflow/VISUAL_CHECKPOINT_WORKFLOW.md) | Pre/post visual checkpoints |
| [`docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md`](docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md) | Surgical restore vs full rollback |
| [`docs/workflow/DESIGN_LANGUAGE_PRESERVATION.md`](docs/workflow/DESIGN_LANGUAGE_PRESERVATION.md) | Typography, color, motion vocabulary |
| [`docs/foundation/BUILD_FRAME_OF_MIND.md`](docs/foundation/BUILD_FRAME_OF_MIND.md) | Artist-world standard, mobile/audio bar for AI builds |

---

## Related platform rules

- Identity: `User + permissions` (guest is entry method only) — `.cursor/rules/platform-architecture.mdc`
- Commerce: Stripe webhook → Supabase → account state — never UI-as-auth-source
