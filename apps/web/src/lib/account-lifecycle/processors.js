import { anonymizeRetainedRecords, cancelSubscriptions, classifyRetention, deleteAuthIdentity, deliverExport, eraseEphemeralData, eraseStorageObjects, expireExportArtifact, freezeIdentity, notifyExternalProcessors, revokeEntitlementsAndSessions, sealEvidence, snapshotExport } from "@/lib/account-lifecycle/certified-processors";

const REQUIRED_STEPS = Object.freeze([
  "freeze_identity", "snapshot_export", "deliver_export", "expire_export_artifact",
  "cancel_subscriptions", "classify_retention", "erase_ephemeral_data",
  "anonymize_retained_records", "erase_storage_objects", "notify_external_processors",
  "revoke_entitlements_and_sessions", "delete_auth_identity", "seal_evidence",
]);

function unavailable(step) {
  return async () => {
    throw Object.assign(new Error(`Lifecycle processor ${step} is not production-certified`), {
      code: `processor_${step}_not_certified`,
    });
  };
}

// Deliberately exhaustive and fail-closed. Each entry is replaced by a certified,
// idempotent processor as its data-retention and external-processor contract closes.
export const accountLifecycleProcessors = Object.freeze({
  ...Object.fromEntries(REQUIRED_STEPS.map((step) => [step, unavailable(step)])),
  freeze_identity: freezeIdentity,
  snapshot_export: snapshotExport,
  deliver_export: deliverExport,
  expire_export_artifact: expireExportArtifact,
  classify_retention: classifyRetention,
  erase_ephemeral_data: eraseEphemeralData,
  anonymize_retained_records: anonymizeRetainedRecords,
  cancel_subscriptions: cancelSubscriptions,
  revoke_entitlements_and_sessions: revokeEntitlementsAndSessions,
  delete_auth_identity: deleteAuthIdentity,
  erase_storage_objects: eraseStorageObjects,
  notify_external_processors: notifyExternalProcessors,
  seal_evidence: sealEvidence,
});
