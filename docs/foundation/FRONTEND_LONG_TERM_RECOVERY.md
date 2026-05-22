# Frontend Long-Term Recovery Safety System

Ongoing practices so the foundation remains recoverable months after this lock.

## 1. Immutable anchor commit

- **UI origin (immutable):** `undefined` (`foundation-stable-v1`)
- **Operational anchor:** `undefined` (`foundation-stable-v3`)
- Stored in: `docs/foundation/recovery-anchor.json` (canonical), `FRONTEND_FOUNDATION_BASELINE.md`, `FRONTEND_RECOVERY_ANCHOR.md`

## One-command recovery (npm)

| Command | Purpose |
|---------|---------|
| `npm run verify:foundation` | Guardrails + smoke + lint + build |
| `npm run recover:foundation` | Full local restore workflow |
| `npm run recover:stable` | Align `frontend-stable-foundation` to anchor |
| `npm run recover:rollback` | Production rollback guide |
| `npm run recover:deploy -- --deploy` | Gated production deploy |
| `npm run snapshot:foundation` | Zip recovery kit to `storage/frontend-recovery-snapshots/` |

Details: `FRONTEND_RECOVERY_COMMAND_REPORT.md`
- Local branch: `frontend-stable-foundation` (points at anchor; refresh with `git branch -f` only when baseline is intentionally updated)

## 2. Tag strategy (recommended, manual)

When the user approves a new baseline:

```bash
git tag -a frontend-foundation-YYYY-MM-DD -m "Official frontend foundation"
# push tag only when credentials allow:
# git push origin frontend-foundation-YYYY-MM-DD
```

Tags survive branch churn and simplify `git checkout frontend-foundation-*`.

## 3. Quarterly audit cadence

Every ~90 days (or before major campaigns):

| Step | Command / action |
|------|------------------|
| Verify pins | `npm run test:foundation` |
| Scan guardrails | `npm run check:frontend-guardrails` |
| Toolchain | `npm run lint && npm run build` |
| Production parity | Manual compare to artist-platform-silk.vercel.app |
| Docs drift | Ensure baseline commit hash matches intentional production deploy |
| Lockfile | `npm ci` clean install on CI machine |

## 4. Dependency update policy

- **Patch/minor** (framer-motion, supabase-js): only on `frontend-feature-dev`, full build + visual check, user approval
- **Major** (next, react): dedicated spike on `frontend-experimental`, never merge without new foundation doc revision
- Record every approved bump in `FRONTEND_FOUNDATION_REPORT.md`

## 5. Backup artifacts

Keep outside the repo if possible:

- Vercel deployment URLs / IDs for last 5 production deploys
- Screenshot or screen recording of baseline `/` (hero, modals, audio bar)
- Export of production env var **names** (not values)

## 6. Incident playbook

| Incident | First action |
|----------|--------------|
| White screen | Check browser console + Vercel function logs; rollback deploy |
| Auth loop | Verify Supabase URL/anon key + middleware; do not patch UI permissions |
| Video mass failure | CDN/path issue — check `public/videos` and control-system media API |
| Stripe broken | Keys + webhook; checkout page isolated test on `/subscribe` |

## 7. Automation roadmap (optional)

- CI job: `npm run test:foundation && npm run check:frontend-guardrails` on PRs touching `src/app/` or `package.json`
- Block merges to `main` on failure
- Scheduled workflow for quarterly audit (GitHub Actions)

## 7. Agent / Cursor safety

- `frontend-foundation.mdc` always applied
- Agents must run guardrails before suggesting `page.js` edits
- New features: backend + leaf components first

**Development workflow integration:** [`PROJECT_GUARDRAILS.md`](../../PROJECT_GUARDRAILS.md) defines protected components, scoped AI behavior, and links to [`docs/workflow/`](../workflow/) (feature branches, mobile-only scope, visual checkpoints). Prefer selective restoration ([`SELECTIVE_RESTORATION_WORKFLOW.md`](../workflow/SELECTIVE_RESTORATION_WORKFLOW.md)) before full `recover:foundation`. Cursor: `.cursor/rules/project-guardrails.mdc`.

## 8. When to advance the anchor

Advance only when:

1. User explicitly declares a new official frontend baseline
2. Full verification suite passes
3. Production has run stable ≥ 48 hours
4. All foundation docs updated with new commit hash

**Operational recovery truth:** `recovery-anchor.json` → `undefined` (`foundation-stable-v3`).  
**UI-only rollback:** `foundation-stable-v1` → `undefined` (unchanged).  
**Historical v2:** `foundation-stable-v2` → `undefined` (same tree as v3; never move).
