# Ownership email-proof release candidate — 2026-10-26

Status: LOCAL RELEASE CANDIDATE; PRODUCTION DEPLOYMENT HELD. Do not push this branch/main until the required database approval and readiness checks are satisfied. A GitHub push can trigger Vercel deployment.

## Problem and corrected boundary

Account reads and gift recovery previously treated mutable contact email, signup confirmation markers, or gift-link possession as authority to copy/reassign another principal's purchase/library/entitlement rows. This repair moves authority to fresh email-only proof bound to the raw Supabase Auth principal, purpose and exact target snapshot. Server-memory proof is validated at the shared grant writers. Ownership writes and receipt consumption commit in one PostgreSQL transaction; write failure rolls both back. An opaque HttpOnly cookie supplies proof context; no plaintext OTP or session bearer credentials are stored in the new table. Existing same-principal completed gift claims remain read-only and idempotent.

## Scope and current-production compatibility

Base: verified GitHub main and existing Vercel production source ea237be9c37eb35d930e21460f92d32722b75c54. Changes: only the 22 approved ownership source/test/migration files plus this release note. No playback, release-deletion, lyrics, pricing, mobile or infrastructure configuration changes are included. The newer deployed release-deletion changes in HomeClient/account state are preserved. Unrelated, undeployed entitlement-window/cache work from the dirty audit checkout is excluded. One import-only conflict was resolved by retaining deployed imports and adding the recovery-form import. The PostgreSQL test loader no longer requires an unrelated undeployed module; its 36 assertions remain unchanged. Original line endings are retained on unchanged lines.

The original website and mobile worktrees retain their branches, HEADs, indices and source edits. All staging/commit activity is confined to this release worktree.

## Fresh verification of this candidate

- Original ownership attack regressions: 3/3 pass, simulated persistence and actual server modules.
- Adjacent payment/gift controls: 7/7 pass; gift signup/UI contracts: 6/6 pass. Mocks do not establish live delivery or physical-device behavior.
- Broad authentication: 254/256 pass. The route-inventory count and wrapper-admin scanner fail; both reproduce on the unmodified production baseline with the same 254/256 result. These are recorded, not waived or reported green.
- Commerce: 40/46 pass. The six resolve-cart fixture failures also reproduce on unmodified production ea237be9; fakeAdmin lacks the .is() method required by the deployed soft-deletion filter. This repair changes neither resolve-cart nor its tests.
- Scoped ESLint: 0 errors, 15 warnings. Isolated Next production Webpack build passes against this exact candidate, with fixture keys, private env excluded and a network-blocking preload. Installed dependencies were reused; this is not a clean-install claim.
- Prior authoritative PostgreSQL checkpoint: 36/36 passed on the earlier audited source. It was NOT rerun for this production-based candidate because its temporary PGlite installation disappeared; restoring the pinned test fixture and rerunning is a remaining check. No production fixture, OTP, login, payment, ownership or playback operation was performed.

## Required migration and deployment gates

The additive migration apps/web/supabase/migrations/20261023000000_ownership_email_handoff.sql creates public.ownership_email_challenges and two indexes, enables RLS and denies client roles. It does not backfill or transfer existing rights. It requires separate remote-migration authorization; approval to commit/deploy is not silently expanded into that previously separated database action. No remote migration was applied.

Existing Vercel project: artist-platform / prj_jlnukzpNHMg72KdbsYFG7ZkCvrgI. Supabase production project: qvfbgkbgczyqrglvgyqr. Read-only management access verifies ACTIVE_HEALTHY project availability. Production variable names exist, but POSTGRES_URL is empty in the local env and Vercel marks the required secrets non-exportable. The table/migration history, verified-TLS runtime connection and workload privileges are not yet established. Do not deploy the tightened gift/recovery flow before this table and the supported transaction path are ready. Review the exact migration, named migration history (including the historical duplicate 20260927130000), source-table columns/constraints and credentials without weakening TLS/RLS. Restore isolated PostgreSQL verification and validate deployment readiness before any permitted rollout. Real delivery, hosted contention, browser cookies/Origin/CSRF and authenticated/native behavior remain unverified.

Retention/cleanup and backup policy require environment review. Media revocation remains NOT PROVEN / BLOCKED, independently of this ownership repair. Native recovery UI, TV, billing, player extraction and 2MRRWBase remain out of scope.

## Deployment command incident and remediation

A Vercel CLI env-run command unexpectedly interpreted its child command as a deployment and created a separate inspect-database project. It was outside the requested target and immediately removed. Deletion returned 204 and a subsequent project lookup returned 404. The existing www.2mrrw.com alias remained on dpl_7bN5eiDZ7P8NVavU19ESDNtLnT9q / artist-platform-6esymxb9o-eellian-morrows-projects.vercel.app at source ea237be9. The uploaded inspection script contained no credentials. Its database execution was not observed. No claim is made that no cloud action occurred; the accidental resource and cleanup are explicitly recorded.

## Safe rollout and recovery

After the separate migration approval, obtain a verified read-only history/schema and transaction credential, restore isolated SQL tests, validate hosted locking/role behavior, apply only the reviewed additive migration, then use the already-authorized deployment path for this exact candidate. Do not apply the whole dirty migration directory, create a Vercel project/preview, or push unrelated work. Recheck remote main/production SHA immediately before promotion. After deployment verify commit/READY/aliases and non-mutating public/anonymous gates; signed-in recovery requires a separately bounded disposable-account exercise. No live playback proof is implied by HTTP/build checks.

Before rollout the local commit can be abandoned without changing original worktrees. After rollout preserve fail-closed writer checks, stop challenge issuance before table retirement, retain receipts for investigation, and never restore implicit profile-email copying. Grants require separate audited corrective decisions; dropping a receipt does not undo a grant.

Evidence is retained outside Git in deployment-evidence/ownership-deploy-20261026-mkwm7c8w, with the immutable prior implementation package in tomorrow-audit-reports/phase10-ownership-implementation-id4kbbna. Only this release note is added to the commit; no private env, credential store, build output, cache or bulk evidence is staged.
