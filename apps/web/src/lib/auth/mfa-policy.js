/**
 * Pure configuration contract for the custom human-admin MFA boundary.
 */
export const HumanAdminMfaPolicyState = Object.freeze({
  REQUIRED: "required",
  DISABLED: "disabled",
  MISSING: "missing",
  INVALID: "invalid",
});

function result(fields) {
  return Object.freeze(fields);
}

export function resolveHumanAdminMfaPolicy({
  rawValue = process.env.HUMAN_ADMIN_MFA_REQUIRED,
  runtimeEnvironment = process.env.NODE_ENV,
} = {}) {
  if (rawValue === undefined || rawValue === null) {
    return result({
      state: HumanAdminMfaPolicyState.MISSING,
      enforced: true,
      allowsWithoutAuthority: false,
      failureReason: "custom_mfa_configuration_missing",
    });
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === "true") {
    return result({
      state: HumanAdminMfaPolicyState.REQUIRED,
      enforced: true,
      allowsWithoutAuthority: false,
      failureReason: null,
    });
  }

  if (normalized === "false") {
    const production = String(runtimeEnvironment || "").trim().toLowerCase() === "production";
    return result({
      state: HumanAdminMfaPolicyState.DISABLED,
      enforced: production,
      allowsWithoutAuthority: !production,
      failureReason: production ? "custom_mfa_disabled_in_production" : null,
    });
  }

  return result({
    state: HumanAdminMfaPolicyState.INVALID,
    enforced: true,
    allowsWithoutAuthority: false,
    failureReason: "custom_mfa_configuration_invalid",
  });
}
