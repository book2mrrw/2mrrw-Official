# Selective Restoration Workflow

**Surgical restore** of one module or file vs **full foundation rollback**. Uses existing recovery tooling — does not add parallel recovery systems.

## Decision matrix

| Symptom | Approach |
|---------|----------|
| Single file / one feature wrong | Selective restore (this doc) |
| `package.json` / lockfile drift | `npm run recover:foundation -- --force` |
| Multiple modules + visual breakage | `npm run recover:foundation` |
| Bad production deploy | `npm run recover:rollback` then local verify |
| Unknown extent | `npm run recover:foundation -- --dry-run` first |

## Canonical anchor

All restores reference:

```
docs/foundation/recovery-anchor.json
```

Fields: `commit`, `sacredOrigin.commit` (UI-only v1), `operationalTag`, `dependencies`.

```bash
# Show anchor without changing working tree
npm run recover:foundation -- --dry-run
```

## Selective restore (by module)

### 1. Identify scope

Map regression to module — [`FEATURE_ISOLATION.md`](FEATURE_ISOLATION.md).

### 2. Restore file(s) from anchor

```bash
ANCHOR=$(node -e "console.log(require('./docs/foundation/recovery-anchor.json').commit)")
git checkout "$ANCHOR" -- src/components/vault/VaultUnlockedRoom.jsx
# add only paths in scope
```

For UI-only origin (immutable v1 UI):

```bash
git checkout foundation-stable-v1 -- src/app/page.js
```

Use v1 **only** when user wants sacred UI origin, not operational v3 tree.

### 3. Re-apply intentional changes

Cherry-pick or manually re-apply commits that belong to the feature branch — avoid blanket merges from `main`.

### 4. Verify module + foundation

```bash
npm run check:frontend-guardrails
npm run test:foundation
npm run lint
npm run build
git diff --check
```

### 5. Visual confirm

[`VISUAL_CHECKPOINT_WORKFLOW.md`](VISUAL_CHECKPOINT_WORKFLOW.md) for affected surfaces only.

## Phase 2 audit pattern (existing)

The repo has used **phase-style** merges (e.g. mobile UX scripts under `scripts/apply-phase1-merge.py`). For AI work:

1. **Audit** — `git diff` + `node scripts/check-scoped-changes.mjs`
2. **Isolate** — list hunks touching protected paths
3. **Restore** — checkout anchor version of offending file
4. **Re-implement** — smaller scoped PR with checkpoint

Do not re-run legacy merge scripts unless user explicitly requests — prefer manual scoped edits.

## Full rollback (existing commands)

When selective restore is insufficient:

```bash
npm run recover:foundation
# optional force (discards local uncommitted work):
npm run recover:foundation -- --force
npm run recover:stable
npm run verify:foundation
```

See [`../foundation/FRONTEND_RECOVERY_COMMAND_REPORT.md`](../foundation/FRONTEND_RECOVERY_COMMAND_REPORT.md).

## Production

1. `npm run recover:rollback` — promote last green Vercel deployment
2. Local: `npm run recover:foundation` + `npm run verify:foundation`
3. Deploy only with `npm run recover:deploy -- --deploy` after verify passes

## Documentation after incident

Add short entry to `docs/foundation/FRONTEND_FOUNDATION_REPORT.md`:

- Module restored
- Anchor commit used
- Selective vs full recovery
- Verify command results
