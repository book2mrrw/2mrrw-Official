# F0 Final Operator Runbook

Execute in order. Never target Production for a destructive drill. Do not enable account lifecycle execution until every gate and retention approval passes.

## 1. Supabase physical restore

1. In Supabase, create a new project named `2MRRW-F0-RESTORE-20260825` in organization `hrfgdtcxvofnfbndkzou`, region `us-east-2`.
2. Do not link its URL or keys to the Production Vercel environment.
3. Use Supabase backup recovery/support workflow to restore physical backup id `1476451890` (`2026-08-25T09:50:50.199Z`) into that distinct project. PITR is unavailable.
4. Record new project ref, restore request/start/completion timestamps and provider job/reference id.
5. Link CLI only after verifying the ref is neither `qvfbgkbgczyqrglvgyqr` nor `sczcxkqqwmjhpetxjiec`:

```powershell
npx.cmd supabase link --project-ref NEW_RESTORE_PROJECT_REF
npx.cmd supabase migration list
```

6. Run read-only `supabase/verify/F0-ACCOUNT-LIFECYCLE-CERTIFICATION.sql` and the E0/E1 certification SQL against the restored project.
7. Compare schema, RLS, functions, triggers, extensions and representative counts/digests for every table named in the final brief. Never print emails, phones, tokens or row bodies into evidence.
8. Record backup timestamp versus newest representative canonical row timestamp for measured RPO. Record declaration-to-ready duration for RTO.

## 2. R2 restore

Operator prerequisites:

- Source credential limited to list/read Production media bucket.
- Separate target credential limited to an isolated bucket or prefix such as `f0-restore/20260825/`.
- Target must not be used by Production URLs, manifests or workers.

Run the existing read-only inventory first:

```powershell
$env:CLOUDFLARE_R2_BUCKET_NAME='SOURCE_BUCKET'
$env:CLOUDFLARE_R2_ENDPOINT='SOURCE_ENDPOINT'
$env:CLOUDFLARE_R2_ACCESS_KEY_ID='SOURCE_READ_KEY'
$env:CLOUDFLARE_R2_SECRET_ACCESS_KEY='SOURCE_READ_SECRET'
node scripts/verify-r2-entity-folders.mjs --json
```

Then use an S3-compatible client to copy a deterministic sample from each class—masters, progressive audio, artwork, video, HLS manifests and HLS segments—to the isolated target. For every sample record key, size, ETag, lastModified and SHA-256 before and after. Parse sampled HLS manifests and assert every referenced segment is present and non-empty. Do not copy or print HLS keys/secrets. Delete the isolated copy only after the report hash is captured and recovery authority approves cleanup.

## 3. Stripe test-mode duplicate replay

1. Install and authenticate Stripe CLI to the correct Stripe account in test mode.
2. Designate a disposable Supabase principal and a disposable test product.
3. Snapshot counts/identifiers for `processed_stripe_events`, purchases, library items, entitlements, gifts/fulfillments and notification receipts for that principal.
4. Start forwarding test webhooks to an isolated Preview deployment backed by an isolated Supabase project—not Production data:

```powershell
stripe login
stripe listen --forward-to https://ISOLATED_PREVIEW/api/webhook
```

5. Create one valid paid test event through Stripe test mode. Capture its event id without copying customer personal data.
6. Replay the exact event at least twice sequentially and concurrently:

```powershell
stripe events resend evt_TEST_ID --webhook-endpoint we_TEST_ENDPOINT
stripe events resend evt_TEST_ID --webhook-endpoint we_TEST_ENDPOINT
```

7. Assert one processed event and exactly one business effect across every applicable ledger. HTTP 200 alone is insufficient. Confirm invalid signature returns 400. Confirm retry after a controlled pre-commit failure converges once.

## 4. RPO/RTO timeline

Use one UTC timeline with: declaration, freeze, restore start, database ready, schema certified, R2 sample restored, Stripe replay complete, web ready and drill closed. Compare measured durations and data window against the targets in `F0-DISASTER-RECOVERY-RUNBOOK.md`. A missed target is FAIL with the measured bottleneck.

## 5. Custom MFA authority

Stop condition: do not execute credential tests until the architecture mismatch is resolved.

Required permanent state:

- Password-only raw Supabase session must lack the server-controlled 2MRRW verification authority.
- Successful login-step2 email/SMS verification must create a server-verifiable, user-bound, expiry-bound, generation-bound authority.
- Admin guard must validate that authority, not Supabase TOTP/AAL2.
- Sign-out and fresh password-only login must invalidate/reject prior authority.
- Cross-user, expired, revoked and generation-stale authority must fail.

After implementation and deployment, the operator supplies the admin password locally—never in chat—and runs an attacker raw password grant plus the normal email/SMS login. Call the same representative admin endpoints from each session. Record password-only 401/403 and verified-session 2xx, then sign out and confirm denial again.

## 6. Lifecycle canaries

1. Obtain dated retention approval from the named legal/business owner.
2. Create disposable principals containing synthetic data across every classified dependency.
3. Keep Production execution disabled. Run first in an isolated restored project with isolated R2/search/cache providers.
4. Run `supabase/verify/principal-dependency-sweep.mjs --audit PRINCIPAL_ID` and retain the machine-derived inventory.
5. Request export, execute bounded workers, download once, verify ciphertext/hash/envelope metadata, decrypt with the documented KEK ceremony, and compare included/excluded fields.
6. Simulate worker interruption after a claimed step, wait for lease expiry, retry and prove fencing prevents the stale worker from committing.
7. Request deletion for a separate canary. Prove retained ledgers are pseudonymized, ephemeral data and exact owned storage keys are removed, Auth deletion occurs last, retries are idempotent and the evidence seal survives.
8. Re-run the dependency sweep and require zero residual source references wherever policy requires zero residue.

## 7. Observability, alert and reconstruction

1. Configure `SENTRY_DSN` for server/edge and `NEXT_PUBLIC_SENTRY_DSN` only if client capture is approved. Configure retention, access control and PII scrubbing.
2. Select the canonical structured security/audit sink; do not assume browser PostHog is sufficient.
3. Configure alerts for lifecycle worker fatal/retry exhaustion, webhook processing failure, upload/publication failure, auth abuse and critical admin operations.
4. Route a controlled synthetic error containing a unique correlation id such as `f0-incident-YYYYMMDD-UUID`.
5. Prove the event arrives centrally, contains no secret/token/email/phone, and triggers the intended operator notification.
6. Reconstruct timestamp, principal/resource pseudonymous id, request/job/event ids, authoritative action, retries and final state from the sink. Record screenshots/export references and alert receipt timestamp.

## Carry-forward operator actions

- **COMPLETED 2026-08-26:** confirmed zero runtime consumers, removed `ADMIN_SEED_SECRET` from Production, and verified absence by name only.
- Rotate the previously exposed Supabase service-role key and update every legitimate consumer atomically.
- Retire `/api/guest/session` after one full legacy-cookie lifetime with zero resolution telemetry.
- Track OTP terminal-state ambiguity and caller-supplied `p_max_attempts`; neither is certified closed by this runbook.
