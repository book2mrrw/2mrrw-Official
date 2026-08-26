import { gzipSync } from "node:zlib";
import { createHmac } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { encryptAccountExport } from "@/lib/account-lifecycle/export-crypto";
import { R2_BUCKET, r2Client } from "@/lib/storage/r2";
import { getStripe } from "@/lib/commerce/stripe";
import { bumpEntitlementGeneration } from "@/lib/server/entitlement-cache";

const EXPORT_TABLES = Object.freeze([
  ["profiles", "id"], ["memberships", "user_id"], ["purchases", "user_id"],
  ["library_items", "user_id"], ["entitlements", "user_id"],
  ["user_entitlements", "user_id"], ["vault_entitlements", "user_id"],
  ["vault_content_progress", "user_id"], ["collector_ownerships", "user_id"],
  ["collector_claims", "user_id"], ["collector_access", "user_id"],
  ["notification_preferences", "user_id"], ["notification_inbox", "user_id"],
  ["media_playback_progress", "user_id"], ["stream_events", "user_id"],
  ["event_checkins", "user_id"], ["gift_transactions", "purchaser_user_id"],
]);

async function receipt(admin, claim, processor, operation, status, extra = {}) {
  const { data, error } = await admin.rpc("record_account_processor_receipt", {
    p_request_id: claim.request_id, p_processor_key: processor,
    p_operation_key: operation, p_status: status,
    p_remote_reference: extra.remoteReference || null,
    p_result_digest: extra.resultDigest || null, p_error_code: extra.errorCode || null,
  });
  if (error) throw error;
  return data;
}

async function readAllRows(admin, table, column, userId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select("*").eq(column, userId).range(from, from + 999);
    if (error) throw Object.assign(error, { code: `export_read_${table}` });
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

export async function freezeIdentity({ admin, claim }) {
  if (!claim.user_id) throw Object.assign(new Error("Lifecycle subject is missing"), { code: "subject_missing" });
  const operation = `freeze:${claim.user_id}`;
  const existing = await receipt(admin, claim, "supabase-auth", operation, "pending");
  if (existing?.status === "completed") return { status: "completed", result: { idempotent: true } };

  const { data: authData, error: readError } = await admin.auth.admin.getUserById(claim.user_id);
  if (readError) throw Object.assign(readError, { code: "auth_subject_read_failed" });
  const current = authData.user?.app_metadata || {};
  const { error } = await admin.auth.admin.updateUserById(claim.user_id, {
    app_metadata: { ...current, account_lifecycle_frozen: true, account_lifecycle_request_id: claim.request_id },
  });
  if (error) throw Object.assign(error, { code: "auth_subject_freeze_failed" });
  await receipt(admin, claim, "supabase-auth", operation, "completed", { remoteReference: claim.user_id });
  return { status: "completed", result: { frozen: true } };
}

export async function classifyRetention({ admin, claim }) {
  const { data, error } = await admin.from("account_retention_policies")
    .select("policy_key,data_domain,disposition,retention_interval,legal_basis,policy_version")
    .eq("enabled", true).order("policy_key");
  if (error) throw Object.assign(error, { code: "retention_policy_unavailable" });
  if (!data?.length) throw Object.assign(new Error("No active retention policy"), { code: "retention_policy_empty" });
  return { status: "completed", result: { policies: data, classified_at: new Date().toISOString() } };
}

export async function snapshotExport({ admin, claim }) {
  if (!claim.user_id) throw Object.assign(new Error("Lifecycle subject is missing"), { code: "subject_missing" });
  if (!R2_BUCKET) throw Object.assign(new Error("R2 bucket is unavailable"), { code: "export_storage_unavailable" });
  const operation = `snapshot:${claim.request_id}`;
  const existing = await receipt(admin, claim, "r2-export", operation, "pending");
  if (existing?.status === "completed") return { status: "completed", result: { idempotent: true } };

  const { data: authData, error: authError } = await admin.auth.admin.getUserById(claim.user_id);
  if (authError) throw Object.assign(authError, { code: "export_auth_read_failed" });
  const tables = {};
  for (const [table, column] of EXPORT_TABLES) tables[table] = await readAllRows(admin, table, column, claim.user_id);
  const exportedAt = new Date().toISOString();
  const document = { schema: "2mrrw.account-export.v1", request_id: claim.request_id, exported_at: exportedAt,
    auth: { id: authData.user.id, email: authData.user.email, phone: authData.user.phone,
      created_at: authData.user.created_at, user_metadata: authData.user.user_metadata }, tables };
  const plaintext = gzipSync(Buffer.from(JSON.stringify(document), "utf8"), { level: 9 });
  const encrypted = encryptAccountExport({ requestId: claim.request_id, plaintext });
  const objectKey = `private/account-exports/${claim.request_id}/export.bin`;
  await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: objectKey, Body: encrypted.envelope,
    ContentType: "application/octet-stream", Metadata: { format: encrypted.format, ciphertext_sha256: encrypted.ciphertextSha256 } }));
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: registerError } = await admin.rpc("register_account_export_artifact", {
    p_request_id: claim.request_id, p_object_key: objectKey, p_content_sha256: encrypted.contentSha256,
    p_byte_size: encrypted.envelope.length, p_key_version: encrypted.keyVersion,
    p_wrapped_data_key: encrypted.wrappedDataKey,
    p_manifest: { schema: document.schema, exported_at: exportedAt, tables: Object.fromEntries(Object.entries(tables).map(([key, value]) => [key, value.length])), ciphertext_sha256: encrypted.ciphertextSha256 },
    p_expires_at: expiresAt,
  });
  if (registerError) throw Object.assign(registerError, { code: "export_artifact_register_failed" });
  await receipt(admin, claim, "r2-export", operation, "completed", { remoteReference: objectKey, resultDigest: encrypted.ciphertextSha256 });
  return { status: "completed", result: { artifact_registered: true, expires_at: expiresAt, byte_size: encrypted.envelope.length } };
}

export async function deliverExport({ admin, claim }) {
  const { data, error } = await admin.from("account_export_artifacts")
    .select("id,expires_at,destroyed_at").eq("request_id", claim.request_id)
    .is("destroyed_at", null).maybeSingle();
  if (error) throw Object.assign(error, { code: "export_artifact_read_failed" });
  if (!data || new Date(data.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error("No live export artifact is available"), { code: "export_artifact_unavailable" });
  }
  return { status: "completed", result: { available: true, expires_at: data.expires_at } };
}

export async function expireExportArtifact({ admin, claim }) {
  const { data: artifact, error } = await admin.from("account_export_artifacts")
    .select("id,object_key,expires_at,destroyed_at").eq("request_id", claim.request_id).maybeSingle();
  if (error) throw Object.assign(error, { code: "export_artifact_read_failed" });
  if (!artifact) throw Object.assign(new Error("Export artifact evidence is missing"), { code: "export_artifact_missing" });
  if (artifact.destroyed_at) return { status: "completed", result: { idempotent: true, destroyed_at: artifact.destroyed_at } };
  const expiresAt = new Date(artifact.expires_at).getTime();
  if (expiresAt > Date.now()) return { status: "deferred", resumeAt: artifact.expires_at, reason: "artifact_not_expired" };

  await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: artifact.object_key }));
  const { data: destroyed, error: destroyError } = await admin.rpc("destroy_account_export_artifact", {
    p_artifact_id: artifact.id,
  });
  if (destroyError) throw Object.assign(destroyError, { code: "export_key_destruction_failed" });
  if (destroyed !== true) throw Object.assign(new Error("Export key destruction was not committed"), { code: "export_key_destruction_not_committed" });
  await receipt(admin, claim, "r2-export", `expire:${artifact.id}`, "completed", { remoteReference: artifact.object_key });
  return { status: "completed", result: { ciphertext_deleted: true, wrapped_key_destroyed: true } };
}

export async function eraseEphemeralData({ admin, claim }) {
  const { data, error } = await admin.rpc("erase_account_ephemeral_data", {
    p_request_id: claim.request_id, p_lease_token: claim.lease_token,
  });
  if (error) throw Object.assign(error, { code: "ephemeral_erasure_failed" });
  return { status: "completed", result: data || { rows_erased: 0 } };
}

export async function anonymizeRetainedRecords({ admin, claim }) {
  const secret = process.env.ACCOUNT_LIFECYCLE_PSEUDONYM_KEY;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw Object.assign(new Error("Account lifecycle pseudonym key is unavailable"), { code: "pseudonym_key_invalid" });
  }
  const subjectRef = `acct_${createHmac("sha256", secret).update(`2mrrw:${claim.user_id}`).digest("hex")}`;
  const { data, error } = await admin.rpc("anonymize_account_retained_records", {
    p_request_id: claim.request_id, p_lease_token: claim.lease_token, p_subject_ref: subjectRef,
  });
  if (error) throw Object.assign(error, { code: "retained_record_anonymization_failed" });
  return { status: "completed", result: data || { anonymized: true } };
}

function pseudonymousSubject(userId) {
  const secret = process.env.ACCOUNT_LIFECYCLE_PSEUDONYM_KEY;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw Object.assign(new Error("Account lifecycle pseudonym key is unavailable"), { code: "pseudonym_key_invalid" });
  }
  return `acct_${createHmac("sha256", secret).update(`2mrrw:${userId}`).digest("hex")}`;
}

export async function eraseStorageObjects({ admin, claim }) {
  const subjectRef = pseudonymousSubject(claim.user_id);
  let deleted = 0;
  for (;;) {
    const { data: objects, error } = await admin.rpc("claim_account_storage_deletions", {
      p_request_id: claim.request_id, p_step_lease_token: claim.lease_token, p_limit: 100,
    });
    if (error) throw Object.assign(error, { code: "storage_inventory_claim_failed" });
    if (!objects?.length) break;
    for (const object of objects) {
      if (object.provider !== "r2") {
        throw Object.assign(new Error(`Unsupported storage provider ${object.provider}`), { code: "storage_provider_unsupported" });
      }
      await r2Client.send(new DeleteObjectCommand({ Bucket: object.bucket, Key: object.object_key }));
      const { data: committed, error: commitError } = await admin.rpc("finish_account_storage_deletion", {
        p_object_id: object.id, p_object_lease_token: object.object_lease_token, p_subject_ref: subjectRef,
      });
      if (commitError || committed !== true) {
        throw Object.assign(commitError || new Error("Storage deletion lease was lost"), { code: "storage_deletion_commit_failed" });
      }
      deleted += 1;
    }
  }
  const { data: blockers, error: blockerError } = await admin.rpc("count_account_storage_blockers", {
    p_request_id: claim.request_id, p_step_lease_token: claim.lease_token,
  });
  if (blockerError) throw Object.assign(blockerError, { code: "storage_blocker_check_failed" });
  if (Number(blockers) > 0) {
    throw Object.assign(new Error("Referenced personal storage objects require retention review"), { code: "storage_references_active" });
  }
  return { status: "completed", result: { objects_deleted: deleted } };
}

export async function cancelSubscriptions({ admin, claim }) {
  const { data: memberships, error } = await admin.from("memberships")
    .select("id,stripe_subscription_id,status").eq("user_id", claim.user_id)
    .in("status", ["active", "trialing", "past_due"]);
  if (error) throw Object.assign(error, { code: "membership_read_failed" });
  const stripe = memberships?.some((membership) => membership.stripe_subscription_id) ? getStripe() : null;
  let canceled = 0;
  for (const membership of memberships || []) {
    const subscriptionId = membership.stripe_subscription_id;
    const operation = `cancel-subscription:${subscriptionId || membership.id}`;
    const existing = await receipt(admin, claim, "stripe", operation, "pending");
    if (existing?.status !== "completed" && subscriptionId) {
      try {
        await stripe.subscriptions.cancel(subscriptionId, {}, { idempotencyKey: `account-delete-${claim.request_id}-${membership.id}` });
      } catch (stripeError) {
        if (stripeError?.code !== "resource_missing") throw stripeError;
      }
    }
    const { error: updateError } = await admin.from("memberships").update({ status: "canceled",
      canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", membership.id);
    if (updateError) throw Object.assign(updateError, { code: "membership_cancel_commit_failed" });
    await receipt(admin, claim, "stripe", operation, "completed", { remoteReference: subscriptionId || membership.id });
    canceled += 1;
  }
  return { status: "completed", result: { subscriptions_canceled: canceled } };
}

export async function revokeEntitlementsAndSessions({ admin, claim }) {
  const { data, error } = await admin.rpc("revoke_account_capabilities", {
    p_request_id: claim.request_id, p_lease_token: claim.lease_token,
  });
  if (error) throw Object.assign(error, { code: "capability_revocation_failed" });
  const generation = await bumpEntitlementGeneration(claim.user_id);
  if (generation === null || generation === undefined) {
    throw Object.assign(new Error("Distributed entitlement revocation could not be confirmed"), { code: "entitlement_cache_revocation_unconfirmed" });
  }
  return { status: "completed", result: { ...(data || {}), cache_generation: generation } };
}

export async function deleteAuthIdentity({ admin, claim }) {
  const operation = `delete-auth:${claim.user_id}`;
  const existing = await receipt(admin, claim, "supabase-auth", operation, "pending");
  if (existing?.status === "completed") return { status: "completed", result: { idempotent: true } };
  const { data: preflight, error: preflightError } = await admin.rpc("preflight_account_auth_deletion", {
    p_request_id: claim.request_id, p_lease_token: claim.lease_token,
  });
  if (preflightError || preflight?.safe_to_delete !== true) {
    throw Object.assign(preflightError || new Error("Auth deletion preflight failed"), { code: "auth_deletion_preflight_failed" });
  }
  const { error } = await admin.auth.admin.deleteUser(claim.user_id, false);
  if (error && error?.status !== 404) throw Object.assign(error, { code: "auth_identity_delete_failed" });
  await receipt(admin, claim, "supabase-auth", operation, "completed", { remoteReference: claim.user_id });
  return { status: "completed", result: { auth_identity_deleted: true } };
}

export async function notifyExternalProcessors({ admin, claim }) {
  const { data: mappings, error } = await admin.from("stripe_customers")
    .select("stripe_customer_id").eq("user_id", claim.user_id);
  if (error) throw Object.assign(error, { code: "stripe_customer_mapping_read_failed" });
  const stripe = mappings?.length ? getStripe() : null;
  let notified = 0;
  for (const mapping of mappings || []) {
    const operation = `anonymize-customer:${mapping.stripe_customer_id}`;
    const existing = await receipt(admin, claim, "stripe", operation, "pending");
    if (existing?.status !== "completed") {
      try {
        await stripe.customers.update(mapping.stripe_customer_id, {
          email: null, phone: null, name: null, address: null,
          metadata: { account_deleted: "true", lifecycle_request_id: claim.request_id },
        }, { idempotencyKey: `account-anonymize-${claim.request_id}-${mapping.stripe_customer_id}` });
      } catch (stripeError) {
        if (stripeError?.code !== "resource_missing") throw stripeError;
      }
    }
    await receipt(admin, claim, "stripe", operation, "completed", { remoteReference: mapping.stripe_customer_id });
    notified += 1;
  }
  return { status: "completed", result: { processors_notified: notified, processor: "stripe" } };
}

export async function sealEvidence({ admin, claim }) {
  const { data, error } = await admin.rpc("seal_account_lifecycle", {
    p_request_id: claim.request_id, p_lease_token: claim.lease_token,
  });
  if (error || data?.committed !== true) throw Object.assign(error || new Error("Evidence seal was not committed"), { code: "evidence_seal_failed" });
  return { status: "committed", result: data };
}
