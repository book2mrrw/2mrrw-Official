const CONFIGURATION_REASONS = new Set([
  "custom_mfa_configuration_missing",
  "custom_mfa_configuration_invalid",
  "custom_mfa_disabled_in_production",
]);

const EXPIRED_REASONS = new Set([
  "custom_mfa_expired",
  "recent_custom_mfa_required",
]);

/**
 * Pure classification shared by protected logs and routes that retain the
 * canonical guard result. Internal reasons are never returned to clients.
 */
export function classifyAdminAuthorityDenial(reason) {
  if (reason === "no_session") {
    return Object.freeze({ code: "ADMIN_AUTH_NO_SESSION", status: 401, level: "info" });
  }
  if (reason === "guest_principal" || reason === "not_admin") {
    return Object.freeze({ code: "ADMIN_AUTH_NOT_ADMIN", status: 403, level: "warn" });
  }
  if (CONFIGURATION_REASONS.has(reason)) {
    return Object.freeze({ code: "ADMIN_AUTH_MFA_CONFIGURATION_ERROR", status: 403, level: "error" });
  }
  if (reason === "custom_mfa_required") {
    return Object.freeze({ code: "ADMIN_AUTH_MFA_REQUIRED", status: 403, level: "warn" });
  }
  if (EXPIRED_REASONS.has(reason)) {
    return Object.freeze({ code: "ADMIN_AUTH_MFA_EXPIRED", status: 403, level: "warn" });
  }
  return Object.freeze({ code: "ADMIN_AUTH_MFA_INVALID", status: 403, level: "warn" });
}
