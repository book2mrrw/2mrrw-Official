# Frontend Recovery Protocol

Step-by-step workflow to restore the official frontend foundation when local or deployed state diverges.

## Severity levels

| Level | Symptom | Action |
|-------|---------|--------|
| L1 | Visual glitch, single component | Fix on `frontend-feature-dev`, guardrail scan, no dependency bumps |
| L2 | Build/lint failure after small change | `git diff` review, revert offending commit, `npm ci` |
| L3 | Broken auth/media/sync | Checkout recovery anchor, verify env vars, redeploy from anchor |
| L4 | Dependency drift / major upgrade accident | Full protocol below |

## Full recovery procedure

### 1. Stop and isolate

```bash
git status
git stash push -m "pre-recovery-wip"   # if needed
```

### 2. Return to anchor commit

```bash
git checkout ce6ae20e34fd7e1bf1278d5f6da5c07fb7fee15c
# OR
git checkout frontend-stable-foundation
```

### 3. Reinstall exact dependencies

```bash
rm -rf node_modules
npm ci
```

If `package-lock.json` was corrupted, restore from anchor commit before `npm ci`.

### 4. Validate foundation

```bash
npm run test:foundation
npm run check:frontend-guardrails
npm run lint
npm run build
git diff --check
```

### 5. Environment check

- Compare `.env.local` to `.env.example` (names only — do not commit secrets)
- Confirm `NEXT_PUBLIC_SUPABASE_*` and Stripe publishable key match Vercel production settings

### 6. Local visual verification

```bash
npm run dev
```

Check: hero MP4, modals, audio bar, account state network call, reduced-motion behavior.

### 7. Production recovery (if deploy is bad)

1. Vercel → project → Deployments → promote last green deployment, **or**
2. Deploy from anchor: checkout anchor → `npm run build` → `npm run deploy:prod` (requires credentials)

### 8. Branch repair

```bash
git branch -f frontend-stable-foundation ce6ae20e34fd7e1bf1278d5f6da5c07fb7fee15c
git checkout frontend-feature-dev   # resume controlled work
```

Never `git push --force` to shared branches without explicit approval.

## Branch strategy (protected structure)

| Branch | Purpose |
|--------|---------|
| `main` | Integration; matches production when healthy |
| `frontend-stable-foundation` | Frozen recovery pointer at anchor commit |
| `frontend-feature-dev` | Default feature work |
| `frontend-animation-testing` | Motion/MP4 experiments |
| `frontend-audit-testing` | Guardrails, lint, foundation smoke |
| `frontend-experimental` | Spikes — discard or cherry-pick |

Workflow:

1. Branch from `frontend-stable-foundation` or current `main` for new work
2. Merge to `main` only after `test:foundation` + `build` pass
3. Update `FRONTEND_FOUNDATION_BASELINE.md` only when user approves a **new** official anchor

## After recovery

Document in `FRONTEND_FOUNDATION_REPORT.md`:

- What broke
- Commit restored
- Verification command outputs (pass/fail)
- Whether production was rolled back

## Escalation

If anchor commit builds but production fails: check Vercel env, Supabase outage, Stripe keys — not UI redesign.
