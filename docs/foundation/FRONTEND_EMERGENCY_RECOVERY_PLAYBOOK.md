# Frontend Emergency Recovery Playbook

Exact sequences for production and local incidents. **No UI redesign** — restore known-good foundation, then fix forward on `frontend-feature-dev`.

**Anchor:** `docs/foundation/recovery-anchor.json`  
**Production:** https://artist-platform-silk.vercel.app

---

## 1. Render collapse (blank page, white screen)

```bash
npm run recover:rollback          # read Vercel promote steps
npm run recover:foundation
npm run verify:foundation
npm run dev
```

Vercel: promote previous green deployment immediately.

Check browser console for `/api/account/state` 500s — if backend, fix API before UI.

---

## 2. Hydration overload / React mismatch errors

```bash
git stash -u -m "pre-hydration-recovery"
npm run recover:foundation -- --force
npm run verify:foundation
```

Do **not** patch `page.js` permissions client-side. Entitlements must come from `/api/account/state`.

---

## 3. Failed deploy (build OK locally, Vercel red)

```bash
npm run verify:foundation
npm run recover:rollback
```

Vercel → failed deployment → logs. Common: missing env var, Edge/runtime mismatch.

Redeploy only after local `npm run build` passes:

```bash
npm run recover:deploy -- --deploy
```

---

## 4. Dependency corruption (`npm ci` fails, wrong React/Next)

```bash
npm run recover:foundation -- --force
```

This restores lockfiles from anchor and runs `npm ci`.

If still failing: delete `node_modules` manually, rerun `npm run recover:foundation -- --force`.

---

## 5. Animation instability (motion jank, runaway loops)

```bash
npm run check:frontend-guardrails
git checkout frontend-animation-testing   # experiments only
```

Recovery path:

```bash
git checkout frontend-stable-foundation
npm run verify:foundation
```

Never merge `frontend-animation-testing` to production without full verify gate.

---

## 6. Sync failures (stale data, control system)

```bash
npm run verify:foundation
```

Confirm `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` in `.env.local` (name only in docs).

Optional health check runs during `recover:foundation` when URL is set.

---

## 7. Broken media (hero MP4, vault audio)

1. Verify public assets still exist under `/videos/` (foundation baseline paths).
2. Vault/signed media: check `/api/vault/media` and Supabase storage env on Vercel.
3. Do not add new local-only production media paths.

```bash
npm run recover:foundation -- --skip-git
npm run verify:foundation
```

---

## 8. Audit overload (guardrails/smoke failing CI)

```bash
npm run check:frontend-guardrails
npm run test:foundation
```

Fix reported file only — prefer leaf extraction over `page.js` edits.

---

## 9. Missing deployment history (Vercel)

1. Deploy from local anchor after verify:

```bash
npm run recover:foundation
npm run recover:deploy -- --deploy
```

2. Record new deployment ID in `recovery-anchor.json` → `deploymentId` field.

---

## Escalation checklist

- [ ] Vercel promote previous green deploy
- [ ] `npm run recover:foundation`
- [ ] `npm run verify:foundation`
- [ ] Visual compare to production URL
- [ ] Document incident in `FRONTEND_FOUNDATION_REPORT.md`
- [ ] Update `recovery-anchor.json` only if promoting a new verified anchor
