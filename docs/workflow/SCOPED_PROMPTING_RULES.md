# Scoped Prompting Rules

How to instruct AI (Cursor agents) without triggering foundation-wide refactors.

## Required prompt structure

Include these elements in every feature task:

1. **Feature module** — e.g. Vault Engine, Mobile Modal, Subscribe (see [`FEATURE_ISOLATION.md`](FEATURE_ISOLATION.md))
2. **In-scope paths** — explicit file list or glob
3. **Out-of-scope** — especially `src/app/page.js` hero/nav unless UI-approved
4. **Mobile flag** — `mobile-only: true` when work must not touch desktop
5. **Recovery hint** — "use existing recovery; do not rebuild recovery scripts"

### Template

```
Scope: feature/vault-pricing-labels
Module: Vault Engine
In scope: src/components/vault/VaultUnlockedRoom.jsx, src/app/api/public/vault/route.js
Out of scope: page.js (except prop wiring if approved), subscribe, checkout, hero
Mobile: false
Constraints: no UI redesign; no dependency bumps; entitlements from /api/account/state only
Recovery: npm run verify:foundation before PR; selective restore if Vault only breaks
```

## Default agent assumptions (unless overridden)

| Assumption | Behavior |
|------------|----------|
| Visual system is final | No layout/spacing/motion redesign |
| `page.js` protected | Leaf wiring only with explicit UI scope |
| Backend auth truth | No client permission hacks |
| Docs-only tasks | No `src/` changes |

## Anti-patterns (do not prompt this way)

- "Refactor the homepage" — unbounded; will touch hero, nav, modals
- "Fix everything mobile" — scope entire shell; split by module
- "Upgrade Next and clean up" — requires foundation promotion + user approval
- "Rebuild checkout and vault together" — violates one-feature-per-branch

## Positive patterns

- "Fix vault subscriber price string in VaultUnlockedRoom only"
- "Mobile cart: increase bottom padding when `isMobile` — do not change desktop cart modal"
- "Add API validation on checkout session route — no page.js changes"
- "Document-only: add workflow section" — no code

## Verification clause

End prompts with:

```
Before finishing: npm run check:frontend-guardrails
If src/app or package.json changed: npm run verify:foundation
Do not commit unless asked.
```

## Cursor rules stack

Always applied:

- `PROJECT_GUARDRAILS.md` (this workflow index)
- `.cursor/rules/project-guardrails.mdc`
- `.cursor/rules/frontend-foundation.mdc`
- `.cursor/rules/platform-architecture.mdc`
