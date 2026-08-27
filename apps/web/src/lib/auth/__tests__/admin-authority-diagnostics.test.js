import assert from "node:assert/strict";
import test from "node:test";
import { classifyAdminAuthorityDenial } from "../admin-authority-diagnostics.js";

const cases = [
  ["no_session", "ADMIN_AUTH_NO_SESSION", 401],
  ["guest_principal", "ADMIN_AUTH_NOT_ADMIN", 403],
  ["not_admin", "ADMIN_AUTH_NOT_ADMIN", 403],
  ["custom_mfa_configuration_missing", "ADMIN_AUTH_MFA_CONFIGURATION_ERROR", 403],
  ["custom_mfa_configuration_invalid", "ADMIN_AUTH_MFA_CONFIGURATION_ERROR", 403],
  ["custom_mfa_disabled_in_production", "ADMIN_AUTH_MFA_CONFIGURATION_ERROR", 403],
  ["custom_mfa_required", "ADMIN_AUTH_MFA_REQUIRED", 403],
  ["custom_mfa_expired", "ADMIN_AUTH_MFA_EXPIRED", 403],
  ["recent_custom_mfa_required", "ADMIN_AUTH_MFA_EXPIRED", 403],
  ["custom_mfa_session_mismatch", "ADMIN_AUTH_MFA_INVALID", 403],
  ["custom_mfa_invalid", "ADMIN_AUTH_MFA_INVALID", 403],
];

for (const [reason, code, status] of cases) {
  test(`${reason} maps to ${code}/${status}`, () => {
    const result = classifyAdminAuthorityDenial(reason);
    assert.equal(result.code, code);
    assert.equal(result.status, status);
    assert.equal(Object.isFrozen(result), true);
  });
}
