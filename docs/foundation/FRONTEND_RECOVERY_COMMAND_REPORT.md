# Frontend Recovery Command Report

Synthesis of the one-command foundation recovery system (2026-05-19).

## Canonical anchor

| Field | Value |
|-------|-------|
| File | `docs/foundation/recovery-anchor.json` |
| Commit | `ce6ae20e34fd7e1bf1278d5f6da5c07fb7fee15c` |
| Stable branch | `frontend-stable-foundation` |
| Production URL | https://artist-platform-silk.vercel.app |
| HEAD at doc time | Matches anchor |

## NPM commands (primary interface)

| Script | Maps to | Purpose |
|--------|---------|---------|
| `npm run recover:foundation` | RUN_FRONTEND_FOUNDATION_RECOVERY | Full restore: git → ci → env warn → guardrails → smoke → build |
| `npm run recover:stable` | RUN_FRONTEND_STABLE_RESTORE | Create/checkout stable branch at anchor |
| `npm run recover:rollback` | RUN_FRONTEND_SAFE_ROLLBACK | Rollback playbook + optional `--local` checkout |
| `npm run recover:deploy` | RUN_FRONTEND_FOUNDATION_DEPLOY | Deploy only with `--deploy` flag |
| `npm run verify:foundation` | VERIFY_FRONTEND_FOUNDATION_STATE | Guardrails + smoke + env + lint + build |
| `npm run snapshot:foundation` | Local snapshot zip | Offline recovery kit |

Existing:

| Script | Role |
|--------|------|
| `npm run test:foundation` | Smoke (pins, docs, critical paths) |
| `npm run check:frontend-guardrails` | Risk pattern scan |
| `npm run deploy:prod` | `vercel deploy --prod --yes` |

## Shell scripts (optional; call Node)

| Path |
|------|
| `scripts/recovery/frontend-foundation-recovery.sh` |
| `scripts/recovery/frontend-stable-restore.sh` |
| `scripts/recovery/frontend-safe-rollback.sh` |
| `scripts/recovery/frontend-foundation-deploy.sh` |
| `scripts/recovery/verify-foundation-state.sh` |

Windows: use `npm run` scripts directly (Node `.mjs` orchestrators).

## Typical sequences

**Daily verify**

```bash
npm run verify:foundation
```

**Local broken after bad merge**

```bash
npm run recover:foundation
```

**Production incident**

```bash
npm run recover:rollback
# Vercel promote, then:
npm run recover:foundation
npm run recover:deploy -- --deploy
```

**Dry-run audit**

```bash
npm run recover:foundation -- --dry-run
```

## Safety rules

- No `git push --force` in scripts
- No `git reset --hard` without `--force`
- No deploy without `--deploy` on `recover:deploy`
- No secrets in stdout
- `page.js` behavior unchanged by recovery system itself

## Documentation map

| Doc | Use when |
|-----|----------|
| `recovery-anchor.json` | Scripts need commit/URL/pins |
| `FRONTEND_RECOVERY_ANCHOR.md` | Human quick reference |
| `CURSOR_RECOVERY_WORKFLOWS.md` | Copy-paste in Cursor |
| `FRONTEND_EMERGENCY_RECOVERY_PLAYBOOK.md` | Incident-specific steps |
| `FRONTEND_LOCAL_RECOVERY.md` | New machine / snapshot restore |
| `FRONTEND_RECOVERY_PROTOCOL.md` | Full protocol |
| `FRONTEND_DEPLOYMENT_RULES.md` | Pre-deploy gates + rollback |

## VS Code tasks

`.vscode/tasks.json` — Run Task → recovery/verify entries.

## Updating the anchor (rare)

1. Verify new commit on `frontend-stable-foundation`
2. Run full `npm run verify:foundation`
3. Update `recovery-anchor.json` (commit, pins, deploymentId, date)
4. Update `FRONTEND_FOUNDATION_BASELINE.md` and `FRONTEND_FOUNDATION_REPORT.md`
5. Tag or document production deploy URL

## Verification after implementing recovery system

```bash
npm run verify:foundation
npm run recover:foundation -- --dry-run
git diff --check
```
