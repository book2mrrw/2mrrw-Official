import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd());
const migration = readFileSync(path.join(root, "supabase/migrations/20260823000040_account_lifecycle_orchestration.sql"), "utf8");
const workerMigration = readFileSync(path.join(root, "supabase/migrations/20260823000041_account_lifecycle_worker_contract.sql"), "utf8");
const retentionMigration = readFileSync(path.join(root, "supabase/migrations/20260823000042_account_lifecycle_retention_and_exports.sql"), "utf8");
const deliveryMigration = readFileSync(path.join(root, "supabase/migrations/20260823000043_account_export_delivery.sql"), "utf8");
const deferralMigration = readFileSync(path.join(root, "supabase/migrations/20260823000044_account_lifecycle_step_deferral.sql"), "utf8");
const deletionMigration = readFileSync(path.join(root, "supabase/migrations/20260823000045_account_deletion_data_boundaries.sql"), "utf8");
const terminalMigration = readFileSync(path.join(root, "supabase/migrations/20260823000046_account_deletion_terminal_revocation.sql"), "utf8");
const storageMigration = readFileSync(path.join(root, "supabase/migrations/20260823000047_account_owned_storage_registry.sql"), "utf8");
const sealMigration = readFileSync(path.join(root, "supabase/migrations/20260823000048_account_lifecycle_evidence_seal.sql"), "utf8");
const route = readFileSync(path.join(root, "src/app/api/account/lifecycle/route.js"), "utf8");
const worker = readFileSync(path.join(root, "src/lib/account-lifecycle/worker.js"), "utf8");
const processors = readFileSync(path.join(root, "src/lib/account-lifecycle/processors.js"), "utf8");
const certifiedProcessors = readFileSync(path.join(root, "src/lib/account-lifecycle/certified-processors.js"), "utf8");
const exportCrypto = readFileSync(path.join(root, "src/lib/account-lifecycle/export-crypto.js"), "utf8");
const cron = readFileSync(path.join(root, "src/app/api/cron/account-lifecycle/route.js"), "utf8");

test("F0-LIFE-1 deletion is a durable leased saga, never a request-time cascade", () => {
  assert.match(migration, /account_lifecycle_requests/);
  assert.match(migration, /account_lifecycle_steps/);
  assert.match(migration, /lease_owner/);
  assert.match(migration, /lease_expires_at/);
  assert.match(migration, /idempotency_key/);
  assert.doesNotMatch(route, /deleteUser|auth\.admin/);
});

test("F0-LIFE-5 worker claims are atomic, ordered, fenced, and service-role only", () => {
  assert.match(workerMigration, /for update of s skip locked/i);
  assert.match(workerMigration, /lease_token/);
  assert.match(workerMigration, /prior\.ordinal < s\.ordinal/);
  assert.match(workerMigration, /auth\.role\(\) <> 'service_role'/);
  assert.match(workerMigration, /revoke all on function public\.claim_account_lifecycle_step[^;]+authenticated/i);
});

test("F0-LIFE-6 retries are bounded and use durable exponential backoff", () => {
  assert.match(workerMigration, /max_attempts integer not null default 8/);
  assert.match(workerMigration, /power\(2,/);
  assert.match(workerMigration, /step_exhausted/);
});

test("F0-LIFE-7 lifecycle evidence survives terminal Auth identity deletion", () => {
  assert.match(workerMigration, /references auth\.users\(id\) on delete set null/i);
  assert.doesNotMatch(workerMigration, /on delete cascade/i);
});

test("F0-LIFE-8 coordinator is bounded, fenced, and never advances unknown work", () => {
  assert.match(worker, /Math\.min\([\s\S]*25/);
  assert.match(worker, /lease_token/);
  assert.match(worker, /processor_not_registered/);
  assert.match(worker, /retry_account_lifecycle_step/);
  assert.doesNotMatch(worker, /finish_account_lifecycle_step[\s\S]{0,500}processor_not_registered/);
});

test("F0-LIFE-9 execution is disabled by default and processors fail closed", () => {
  assert.match(cron, /ACCOUNT_LIFECYCLE_EXECUTION_ENABLED !== "true"/);
  assert.match(cron, /timingSafeEqual/);
  assert.match(processors, /not production-certified/);
  assert.doesNotMatch(processors, /status:\s*"completed"/);
});

test("F0-LIFE-10 retention policy separates erasure from retained evidence", () => {
  assert.match(retentionMigration, /account_retention_policies/);
  assert.match(retentionMigration, /commerce\.financial'[\s\S]*?'anonymize'/);
  assert.match(retentionMigration, /collector\.provenance'[\s\S]*?'anonymize'/);
  assert.match(retentionMigration, /playback\.ephemeral'[\s\S]*?'erase'/);
  assert.match(retentionMigration, /policy_version integer/);
});

test("F0-LIFE-11 exports require envelope-encryption metadata and expiry", () => {
  assert.match(retentionMigration, /AES-256-GCM/);
  assert.match(retentionMigration, /wrapped_data_key/);
  assert.match(retentionMigration, /content_sha256/);
  assert.match(retentionMigration, /expires_at/);
  assert.match(retentionMigration, /account_export_one_live_artifact/);
});

test("F0-LIFE-12 destructive and external operations have durable idempotency receipts", () => {
  assert.match(retentionMigration, /account_processor_receipts/);
  assert.match(retentionMigration, /primary key \(request_id, processor_key, operation_key\)/);
  assert.match(retentionMigration, /account_processor_receipts\.status='completed'/);
  assert.match(retentionMigration, /auth\.role\(\) <> 'service_role'/);
});

test("F0-LIFE-13 certified processors replace fail-closed placeholders explicitly", () => {
  assert.match(processors, /freeze_identity:\s*freezeIdentity/);
  assert.match(processors, /snapshot_export:\s*snapshotExport/);
  assert.match(processors, /classify_retention:\s*classifyRetention/);
  assert.match(certifiedProcessors, /record_account_processor_receipt/);
  assert.match(certifiedProcessors, /register_account_export_artifact/);
});

test("F0-LIFE-14 account exports use per-artifact envelope encryption", () => {
  assert.match(exportCrypto, /randomBytes\(32\)/);
  assert.match(exportCrypto, /aes-256-gcm/);
  assert.match(exportCrypto, /setAAD/);
  assert.match(exportCrypto, /getAuthTag/);
  assert.match(exportCrypto, /dataKey\.fill\(0\)/);
  assert.match(certifiedProcessors, /private\/account-exports/);
  assert.doesNotMatch(certifiedProcessors, /getPublicR2Url/);
});

test("F0-LIFE-15 export delivery is authenticated, integrity checked, and non-cacheable", () => {
  const download = readFileSync(path.join(root, "src/app/api/account/lifecycle/[requestId]/download/route.js"), "utf8");
  assert.match(download, /eq\("user_id", user\.id\)/);
  assert.match(download, /failureMode:\s*"closed"/);
  assert.match(download, /export_digest_mismatch/);
  assert.match(download, /private, no-store/);
  assert.match(download, /mark_account_export_delivered/);
  assert.doesNotMatch(download, /createR2SignedGetUrl|getPublicR2Url/);
});

test("F0-LIFE-16 delivery evidence and key destruction are service-role atomic operations", () => {
  assert.match(deliveryMigration, /mark_account_export_delivered/);
  assert.match(deliveryMigration, /expires_at > now\(\)/);
  assert.match(deliveryMigration, /wrapped_data_key='DESTROYED'/);
  assert.match(deliveryMigration, /auth\.role\(\) <> 'service_role'/);
});

test("F0-LIFE-17 scheduled deferral is fenced and does not consume retry budget", () => {
  assert.match(deferralMigration, /lease_token=p_lease_token/);
  assert.match(deferralMigration, /lease_expires_at > now\(\)/);
  assert.match(deferralMigration, /attempt_count=greatest\(0,attempt_count-1\)/);
  assert.match(deferralMigration, /auth\.role\(\) <> 'service_role'/);
  assert.match(worker, /outcome\.status === "deferred"/);
});

test("F0-LIFE-18 expiry deletes ciphertext before destroying its wrapped key", () => {
  const deleteAt = certifiedProcessors.indexOf("DeleteObjectCommand");
  const destroyAt = certifiedProcessors.indexOf("destroy_account_export_artifact");
  assert.ok(deleteAt >= 0 && destroyAt > deleteAt);
  assert.match(certifiedProcessors, /artifact_not_expired/);
  assert.match(processors, /expire_export_artifact:\s*expireExportArtifact/);
});

test("F0-LIFE-19 financial and collector evidence survives auth deletion pseudonymously", () => {
  for (const table of ["purchases", "gift_transactions", "collector_ownerships", "collector_claims"]) {
    assert.match(deletionMigration, new RegExp(`alter table public\\.${table}[\\s\\S]*?lifecycle_subject_ref`));
  }
  assert.match(deletionMigration, /references auth\.users\(id\) on delete set null/g);
  assert.match(deletionMigration, /receipt_url=null/);
  assert.match(deletionMigration, /shipping_address_line1=null/);
});

test("F0-LIFE-20 destructive database processors require the active fenced step lease", () => {
  assert.match(deletionMigration, /lifecycle_assert_step_lease/);
  assert.match(deletionMigration, /s\.lease_token=p_lease_token/);
  assert.match(deletionMigration, /s\.lease_expires_at > now\(\)/);
  assert.match(certifiedProcessors, /createHmac\("sha256"/);
  assert.match(processors, /erase_ephemeral_data:\s*eraseEphemeralData/);
  assert.match(processors, /anonymize_retained_records:\s*anonymizeRetainedRecords/);
});

test("F0-LIFE-21 auth deletion has a database-enforced zero-live-reference preflight", () => {
  assert.match(terminalMigration, /preflight_account_auth_deletion/);
  assert.match(terminalMigration, /v_blockers > 0/);
  assert.match(terminalMigration, /lifecycle_assert_step_lease\(p_request_id,'delete_auth_identity'/);
  assert.match(certifiedProcessors, /preflight_account_auth_deletion/);
  assert.ok(certifiedProcessors.indexOf("preflight_account_auth_deletion") < certifiedProcessors.indexOf("deleteUser"));
});

test("F0-LIFE-22 subscription cancellation and capability revocation are durable", () => {
  assert.match(certifiedProcessors, /stripe\.subscriptions\.cancel/);
  assert.match(certifiedProcessors, /idempotencyKey/);
  assert.match(certifiedProcessors, /record_account_processor_receipt/);
  assert.match(terminalMigration, /revoke_account_capabilities/);
  assert.match(certifiedProcessors, /bumpEntitlementGeneration/);
  assert.match(processors, /delete_auth_identity:\s*deleteAuthIdentity/);
});

test("F0-LIFE-23 personal storage deletion is exact-key, referenced, and lease fenced", () => {
  assert.match(storageMigration, /unique\(provider,bucket,object_key\)/);
  assert.match(storageMigration, /reference_count=0/);
  assert.match(storageMigration, /for update skip locked/);
  assert.match(storageMigration, /object_lease_token/);
  assert.match(storageMigration, /Catalog\/release media must never be registered here/);
  assert.match(processors, /erase_storage_objects:\s*eraseStorageObjects/);
});

test("F0-LIFE-24 referenced or unsupported storage fails closed", () => {
  assert.match(certifiedProcessors, /storage_references_active/);
  assert.match(certifiedProcessors, /storage_provider_unsupported/);
  assert.match(certifiedProcessors, /finish_account_storage_deletion/);
  assert.doesNotMatch(certifiedProcessors, /listR2Objects/);
});

test("F0-LIFE-25 evidence sealing is immutable and atomic with saga completion", () => {
  assert.match(sealMigration, /account_lifecycle_seals/);
  assert.match(sealMigration, /before update or delete/);
  assert.match(sealMigration, /digest\(convert_to\(v_evidence::text,'UTF8'\),'sha256'\)/);
  assert.match(sealMigration, /set status='completed',completed_at=now\(\)/);
  assert.match(worker, /outcome\.status === "committed"/);
  assert.match(processors, /seal_evidence:\s*sealEvidence/);
});

test("F0-LIFE-26 Stripe customer identifiers are anonymized with durable receipts", () => {
  assert.match(certifiedProcessors, /anonymize-customer:/);
  assert.match(certifiedProcessors, /email:\s*null, phone:\s*null, name:\s*null/);
  assert.match(certifiedProcessors, /account_deleted:\s*"true"/);
  assert.match(certifiedProcessors, /idempotencyKey/);
  assert.match(processors, /notify_external_processors:\s*notifyExternalProcessors/);
});

test("F0-LIFE-2 export and deletion have distinct step graphs", () => {
  assert.match(migration, /if p_kind = 'export'/);
  assert.match(migration, /deliver_export/);
  assert.match(migration, /delete_auth_identity/);
  const exportBranch = migration.match(/if p_kind = 'export'[\s\S]*?else/)?.[0] || "";
  assert.doesNotMatch(exportBranch, /delete_auth_identity|erase_ephemeral_data/);
});

test("F0-LIFE-3 users have cooling-off cancellation but cannot execute the saga", () => {
  assert.match(migration, /interval '14 days'/);
  assert.match(migration, /status='cooling_off'/);
  assert.match(migration, /revoke all on public\.account_lifecycle_requests/);
  assert.match(migration, /grant select on public\.account_lifecycle_requests to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete) on public\.account_lifecycle_steps to authenticated/i);
});

test("F0-LIFE-4 lifecycle requests are rate-limited fail-closed and correlated", () => {
  assert.match(route, /failureMode:\s*"closed"/);
  assert.match(route, /x-correlation-id/i);
  assert.match(route, /request_account_lifecycle/);
  assert.match(route, /cancel_account_deletion/);
});
