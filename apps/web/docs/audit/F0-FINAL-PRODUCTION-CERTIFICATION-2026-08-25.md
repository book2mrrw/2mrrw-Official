# 2MRRW F0 Final Production Certification

Generated: 2026-08-25 (America/Chicago)

## 1. Executive verdict

**F0 VERIFICATION OPEN**

The forensic audit is complete. Production deployment, lifecycle database reconciliation, Gate 1 Supabase recovery, Gate 2 R2 recovery, Gate 3 Stripe replay, and Gate 5 custom MFA certification passed. The remaining RPO, lifecycle-canary, retention, and observability gates remain open.

## 2. F0 coverage status

34/34 domains accounted for, 0 PARTIAL, 0 UNTOUCHED. Forensic coverage remains closed.

## 3. F0 verification status

Open. Required live gates 1-7 are not all satisfied. Slice 1D remains blocked.

## 4. Gate 1 - Supabase recovery

Verdict: **PASS - PHYSICAL RESTORE TO A DISTINCT PROJECT CERTIFIED**.

Evidence:

- Production project: `qvfbgkbgczyqrglvgyqr`, region `us-east-2`.
- Eight completed physical backups were listed; newest observed backup: `2026-08-25T09:50:50.199Z`, id `1476451890`.
- `pitr_enabled=false`; `walg_enabled=true`.
- Physical backup restoration created distinct project `gnzxcwwzufbnfsfgriep`, `2MRRW-F0-Recovery-20260826`, in `us-east-2`.
- The project reached `ACTIVE_HEALTHY` no later than `2026-08-26T15:34:57.9980486Z`, 316.776 seconds after its recorded creation time.
- Production and the clone exposed the same 115 PostgREST paths and 81 schemas. Both path sets hashed to `F8816540A77B20055D3BBA7837755D9A78F164DF4C144AFD33090C7D4ECDE7A6`.
- Exact counts matched for releases (8), catalog tracks (30), products (23), admin principals (1), account lifecycle requests (0), MFA generations (1), and processed Stripe events (0 at the certification snapshot).
- The clone contained seven MFA sessions and 20 MFA events versus Production's eight and 21, consistent with exactly one post-backup live MFA certification event/session.
- Anonymous access was denied for admin principals, all three custom-MFA authority tables, and account lifecycle requests.

Reusable verifier: `scripts/recovery/certify-supabase-physical-clone.ps1`. No Production row was mutated by clone certification.

## 5. Gate 2 - R2 restore

Verdict: **PASS - LIVE ISOLATED-PREFIX RESTORE AND BYTE-INTEGRITY CERTIFIED**.

Authenticated Wrangler access to Cloudflare account `992d4f5d45e7c56189a518c2f417fe25` and bucket `2mrrw-media` was established. A temporary read-only remote binding enumerated the live bucket and identified canonical master-audio and cover-art objects without exposing credentials. Restore copies were written only beneath isolated certification prefixes.

Representative byte-integrity evidence:

| Class | Source | Bytes | SHA-256 | Result |
|---|---|---:|---|---|
| Master audio | `digital-assets/features/2-heavy/2 Heavy ft. 2mrrw .wav` | 41,861,106 | `FC9CC328AE4A5FCEB9D15E7DB32589B18B6F4C3109EEE184262163A4EF418C75` | exact match |
| Cover art | `images/singles/hour-glass/images_singles_hourglass.jpg` | 736,553 | `D35241F5587275FA539655895CBF3287B30CD094A63C7DC05FC1D9AB78ADB0DA` | exact match |
| Progressive audio | `digital-assets/singles/hour-glass/audio.mp3` | 7,165,827 | `932165E6D8DA2C0F96D45CA70033B56DC354BB0CC7C870DD49A0F4A5D872DAF0` | exact match |
| Video | `videos/singles/hour-glass/hourglass.mp4` | 1,104,855 | `2B5CC8D142F66E549C3C34D471893DC742C7C486C89CAA8A2730138E3217A445` | exact match |
| Encrypted HLS segment | `hls/singles/hour-glass/320k/seg_00001.ts` | 195,344 | `2F91D85F6378DBEA82A48C79101618C96183AEC253287CF5EF0F379387CF916C` | exact match |

The master and cover were restored beneath `f0-restore/20260826t151800z-codex/`; the other three classes were restored beneath `f0-restore/20260826t150450z-codex/`. Source and re-downloaded restore sizes and SHA-256 digests matched. The first three-class drill completed in 41.784 seconds; the later master/cover transfer phases consumed approximately 16.7 seconds of measured CLI wall time. Both are well inside the four-hour R2 RTO target. The source objects were not mutated, and HLS behavior was not changed.

## 6. Gate 3 - Stripe duplicate replay

Verdict: **PASS - LIVE STRIPE SANDBOX EXACTLY-ONCE REPLAY**.

The official Stripe CLI 1.50.5 was authenticated to `2MRRW sandbox · sandbox`. A real test-mode `checkout.session.completed` event was created for a disposable user existing only in restored project `gnzxcwwzufbnfsfgriep`. The canonical Next.js webhook route received the same signed event twice through a child process whose environment explicitly excluded Production provider credentials.

Observed result: first delivery 200; replay 200 with `duplicate=true`; one `processed_stripe_events` claim; one purchase; one library item. The final drill completed in 14.552 seconds, below the two-hour Stripe RTO target. Disposable clone data was removed and no certification process remained running.

The previously documented fail-open idempotency branch was closed: any claim error other than unique violation now emits `stripe_webhook_idempotency_claim_failed`, returns retryable 503, and performs no fulfillment. Auth/security regression is 203/203. Reusable verifier: `scripts/recovery/certify-stripe-exactly-once.mjs`.

## 7. Gate 4 - measured RPO/RTO

Verdict: **FAIL - SUPABASE RPO TARGET MISSED; RTO MEASUREMENTS PASS**.

Targets:

| System | RPO target | RTO target |
|---|---:|---:|
| Web | 0 | 15 minutes |
| Supabase | 15 minutes | 2 hours |
| R2 | 24 hours | 4 hours |
| Redis | 0 | 30 minutes |
| Stripe | 0 | 2 hours |
| HLS derived media | 24 hours | 8 hours |

Measured results:

- Supabase physical-clone RTO: at most 316.776 seconds, below the two-hour target.
- R2 recovery RTO: 41.784 seconds for the first three-class drill and approximately 16.7 seconds for the later master/cover phases, below the four-hour target.
- Stripe replay RTO: 14.552 seconds, below the two-hour target; Stripe's canonical event retained the complete test-mode event, satisfying zero application event loss for the drill.
- Supabase RPO: FAIL. The newest selected daily physical backup was created at approximately `2026-08-26T09:53:17.070Z`, while the clone began at `2026-08-26T15:29:41.222043Z`, a recovery-point lag of approximately 5 hours 36 minutes. `pitr_enabled=false`; therefore the stated 15-minute Supabase RPO is not currently achievable.

Gate 4 cannot pass until PITR (or an independently proven <=15-minute backup mechanism) is enabled and a second drill demonstrates the target, or the approved business RPO is formally revised.

Operator disposition on 2026-08-26: paid PITR was declined and the RPO improvement was explicitly deferred. This is accepted deployment debt, not a PASS or an F0 closure claim. The verified code may deploy while Slice 1D and the final F0 closure verdict remain blocked on the outstanding operational gates.

## 8. Gate 5 - custom MFA live certification

Verdict: **PASS — CUSTOM MFA LIVE AUTHORITY**.

Production evidence:

- `requireAdminActor()` enforces the durable 2MRRW MFA authority; Supabase AAL/TOTP is not the human-admin boundary.
- `HUMAN_ADMIN_MFA_REQUIRED` is configured and missing/invalid values fail closed.
- A raw Supabase password session was denied across all 34 HUMAN_ADMIN and ADMIN_OR_SERVICE_CAPABILITY routes.
- Normal password + 2MRRW six-digit OTP established authority and allowed a representative admin route.
- OTP replay, cross-session mixing, generation revocation, expiration, and sign-out invalidation all denied access as required.
- Final certified deployment: `dpl_G3ZMzKCnYAYvt5uVJjFUUMwDjaWq`.

## 9. Gate 6 - account export canary

Verdict: **BLOCKED - OPERATOR ACTION REQUIRED**.

The export implementation, encryption contract and tests exist. Production KEK variable names exist, but key material cannot be exported by this CLI session and no disposable principal was supplied. No live export was requested, downloaded, decrypted or compared to canonical user data.

## 10. Gate 6 - account deletion canary

Verdict: **BLOCKED - correctly execution-gated**.

Lifecycle worker schema is deployed and 12/12 service RPCs are visible; anonymous worker invocation returns 401. No disposable principal or approved retention policy exists. No destructive execution was started.

## 11. Retention-policy status

**NOT APPROVED**. Database policy rows are implementation inputs, not evidence of legal/business approval. Named approver and dated approval are required.

## 12. Export-key recovery result

**NOT CERTIFIED**. Configuration names exist; no offline recovery/decryption ceremony was performed. Lost-key behavior remains permanent loss of encrypted exports by design unless a separately controlled recovery copy exists.

## 13. Gate 7 - central observability

Verdict: **BLOCKED**.

Structured server events and Sentry integration code exist. Production contains neither `SENTRY_DSN` nor `NEXT_PUBLIC_SENTRY_DSN`. Production also contains no `NEXT_PUBLIC_POSTHOG_KEY`. Vercel logs are available operationally, but no evidence shows a durable canonical security/audit sink with retention and search requirements.

## 14. Alert routing

Verdict: **BLOCKED**. No configured alert destination or successful operator delivery was found. No synthetic alert was sent.

## 15. Incident reconstruction

Verdict: **BLOCKED**. Correlation IDs are emitted on several critical paths, but without a configured central sink and alert route, an end-to-end reconstruction drill cannot be certified.

## 16. Commands/scripts used or created

Executed read-only/live commands included:

- `supabase backups list --project-ref qvfbgkbgczyqrglvgyqr --output json`
- `supabase branches list --project-ref qvfbgkbgczyqrglvgyqr --output json`
- `vercel env ls production`
- protected and public HTTP canaries against Preview and Production
- PostgREST OpenAPI schema comparisons for branch and Production
- anonymous no-match lifecycle RPC authorization probes
- `npm.cmd run test:auth-security` (192/192)
- authenticated Wrangler bucket inventory through a temporary read-only remote binding
- isolated-prefix R2 download, restore, re-download, byte-count, and SHA-256 comparison for five representative asset classes

Created operator procedure: `docs/recovery/F0-FINAL-OPERATOR-RUNBOOK-2026-08-25.md`.

## 17. Operator actions still required

1. Enable and certify a Supabase recovery mechanism capable of the approved 15-minute RPO, or formally revise that target.
2. Designate disposable export/deletion principals and approve retention policy.
3. Configure a central sink plus alert destination and perform a synthetic incident drill.

## 18. Files modified during this final certification phase

- `docs/audit/F0-FINAL-PRODUCTION-CERTIFICATION-2026-08-25.md`
- `docs/recovery/F0-FINAL-OPERATOR-RUNBOOK-2026-08-25.md`

## 19. Files created during this final certification phase

The same two files listed in section 18 are new.

## 20. Migrations created/applied

No new migration was created during this final-certification phase. Immediately before it, migration `20260824000049_reconcile_account_lifecycle_worker_rpcs.sql` was created and manually applied first to the isolated branch and then Production. Both were verified at 12/12 lifecycle service RPCs with anonymous denial.

## 21. New defects discovered

Closed Critical: the custom email/SMS MFA authority mismatch was remediated and live-certified.

Closed High: independent Cloudflare Wrangler access was authenticated and the R2 restore/integrity drill passed. Stripe CLI is independently authenticated to the dedicated 2MRRW sandbox; replay remains blocked only on an isolated database target.

High: no configured central observability sink or alert route was found.

## 22. Unresolved Critical/High

- High: Supabase's 15-minute RPO target is missed while PITR is disabled.
- High: lifecycle canary and retention/export recovery absent.
- High: central sink/alert/reconstruction absent.
- Closed High disposition: the disclosed legacy Supabase API keys were disabled
  by the project operator on 2026-08-26 after every executable repository
  consumer was migrated. Vercel deployment `dpl_5HmGDQC3KiycVDP5QrRNiPUpbBDz`
  is READY with no legacy Supabase variables; post-deactivation home, login,
  events, shows, and vault canaries returned 200 and the unauthenticated admin
  boundary returned 401. Fly HLS worker version 19 remained started with only
  `SUPABASE_SECRET_KEY` and no Supabase authentication errors.
- Closed High disposition: `ADMIN_SEED_SECRET` had zero runtime consumers and was removed from Production on 2026-08-26; name-only verification confirmed absence.

## 23. Structural blockers

- Physical restore, R2 recovery, and isolated Stripe replay are certified; Supabase RPO remains below policy.
- Custom MFA authority mismatch closed; no remaining Gate 5 blocker.
- No approved retention authority/disposable lifecycle principal.
- No central sink or alert destination.

## 24. Account lifecycle execution flag

Final state: disabled/fail-closed. The cron route returns 403 without its credential, and code additionally requires `ACCOUNT_LIFECYCLE_EXECUTION_ENABLED === "true"`. No certification authorizes enabling it.

## 25. HLS preservation verdict

Preserved. No HLS architecture, manifest, segment, encryption or playback behavior was changed during certification. The worker credential input was migrated from the legacy service-role environment variable to the Supabase secret-key variable and live-certified on Fly version 19. A representative encrypted HLS segment was restored under an isolated prefix with identical byte count and SHA-256 digest.

## 26. Playback preservation verdict

Preserved. Playback Core was not changed. Previously verified suites remain the current evidence baseline.

## 27. Final gate matrix

| Gate | Verdict |
|---|---|
| Supabase restore | PASS |
| R2 restore | PASS |
| Stripe exactly-once replay | PASS |
| Measured RPO/RTO | FAIL - Supabase RPO |
| Custom MFA authority | PASS |
| Account lifecycle canaries | BLOCKED |
| Retention/export recovery | BLOCKED |
| Central sink | BLOCKED |
| Alert routing | BLOCKED |
| Incident reconstruction | BLOCKED |

**F0 VERIFICATION OPEN**
