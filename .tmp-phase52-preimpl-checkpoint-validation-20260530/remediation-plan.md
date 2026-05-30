# Phase 5.2 Pre-Implementation — Remediation Plan

**Triggered by:** Layer 1 FAIL (Application Recovery)  
**Goal:** Pass automated checkpoint validation and authorize Phase 5.2 implementation  
**Scope:** Recovery metadata + verification only — not Phase 5.2 hybrid code

---

## Priority 1 — Promote recovery anchor (blocking)

### Problem

- HEAD: `e8402d8` (153 commits ahead of `foundation-stable-v3` / `0866f99`)
- `npm run verify:foundation` hard-fails on HEAD mismatch
- `npm run recover:foundation` would restore stale pre-Phase-4.8 tree

### Actions

1. **Choose anchor commit** (recommended: `e8402d8` for current main, or `23f77e4` to pin Phase 4.8 playback baseline)
2. Update `docs/foundation/recovery-anchor.json`:
   - `commit` → chosen SHA
   - `operationalCommit` → same
   - `anchoredAt` / `documentedAt` → current date
3. Advance git tag (with explicit user approval):
   ```bash
   git tag -f foundation-stable-v3 <chosen-sha>
   git branch -f frontend-stable-foundation <chosen-sha>
   ```
4. Run checkpoint:
   ```bash
   npm run recover:checkpoint -- "Phase 5.2 pre-impl gate — anchor promoted"
   ```

### Verification

```bash
npm run verify:foundation
npm run test:foundation
```

**Exit criteria:** Both pass with zero HEAD mismatch failures.

---

## Priority 2 — Sync foundation baseline doc

### Problem

`FRONTEND_FOUNDATION_BASELINE.md` shows `undefined` for commit hashes; smoke test fails baseline doc check.

### Actions

1. Update anchor table with current HEAD commit, message, date
2. Reference `recovery-anchor.json` as canonical source
3. Note Phase 4.8 checkpoint `23f77e4` in architectural snapshot if relevant

### Verification

`npm run test:foundation` — baseline doc check passes.

---

## Priority 3 — Fix dependency pin drift

### Problem

Smoke test fails on non-exact pins:

- `colorthief`: `^3.3.1`
- `posthog-js`: `^1.376.0`

### Actions

1. Pin to exact versions in `package.json`
2. Regenerate `package-lock.json` via `npm ci` compatible install
3. Re-run guardrails scan

**Note:** Requires user approval per foundation rules for lockfile changes.

---

## Priority 4 — Refresh recovery protocol doc

### Problem

`FRONTEND_RECOVERY_PROTOCOL.md` Step 2 cites `ce6ae20` as primary checkout; should reference `recovery-anchor.json` / `frontend-stable-foundation`.

### Actions

1. Replace hardcoded commit with pointer to `recovery-anchor.json`
2. Document Phase checkpoint tags (`frontend-checkpoint-*`)
3. Cross-link Phase 4.8 rollback doc (`.tmp-phase48-playback-fastpath-20260529/rollback-paths.md`)

---

## Priority 5 — Optional hardening (recommended before 5.2 prod)

| Item | Action | Owner |
|------|--------|-------|
| DB recovery doc | Add Supabase PITR / migration replay section to `FRONTEND_LONG_TERM_RECOVERY.md` | Foundation |
| R2 inventory script | Read-only bucket list for 36 entity folders (Phase 5.1 gap) | Media ops |
| Flag scaffolding | Add `STREAM_PLAYBACK_PREFERRED` reader defaulting to `0` before resolver changes | Phase 5.2 impl |
| Rollback drill | Staging test: set flag off after mock stream deploy | Phase 5.2 impl |

---

## Re-validation gate

After Priorities 1–3 complete:

1. Re-run full Phase 5.2 pre-impl checkpoint validation
2. Target verdict: Layer 1 **PASS**; overall **PHASE 5.2 IMPLEMENTATION AUTHORIZED**
3. Then begin 5.2 implementation per Phase 5.1 migration plan (5b ingest → 5c resolver → 5d canary hold)

---

## Estimated effort

| Priority | Effort | Blocks 5.2? |
|----------|--------|-------------|
| P1 Anchor promotion | 30 min | **Yes** |
| P2 Baseline doc | 15 min | **Yes** |
| P3 Pin drift | 15 min | **Yes** (smoke test) |
| P4 Protocol doc | 20 min | No |
| P5 Hardening | 1–2 days | No (pre-prod) |

---

## Do not do (out of scope for remediation)

- Implement hybrid streaming / transcode pipeline
- Modify R2 bucket contents
- Change playback resolver behavior
- Deploy to production without user request
