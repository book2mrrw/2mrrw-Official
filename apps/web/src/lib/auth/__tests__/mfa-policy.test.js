import assert from "node:assert/strict";
import test from "node:test";
import {
  HumanAdminMfaPolicyState,
  resolveHumanAdminMfaPolicy,
} from "../mfa-policy.js";

test("missing MFA policy is a distinct fail-closed configuration error", () => {
  const policy = resolveHumanAdminMfaPolicy({ rawValue: undefined, runtimeEnvironment: "production" });
  assert.equal(policy.state, HumanAdminMfaPolicyState.MISSING);
  assert.equal(policy.enforced, true);
  assert.equal(policy.allowsWithoutAuthority, false);
  assert.equal(policy.failureReason, "custom_mfa_configuration_missing");
});

for (const rawValue of ["", "   ", "1", "0", "yes", "no", "on", "off", "bogus"]) {
  test(`malformed MFA policy ${JSON.stringify(rawValue)} is invalid, never missing`, () => {
    const policy = resolveHumanAdminMfaPolicy({ rawValue, runtimeEnvironment: "production" });
    assert.equal(policy.state, HumanAdminMfaPolicyState.INVALID);
    assert.equal(policy.enforced, true);
    assert.equal(policy.failureReason, "custom_mfa_configuration_invalid");
  });
}

for (const rawValue of ["true", " TRUE ", "TrUe"]) {
  test(`MFA policy ${JSON.stringify(rawValue)} requires authority`, () => {
    const policy = resolveHumanAdminMfaPolicy({ rawValue, runtimeEnvironment: "production" });
    assert.equal(policy.state, HumanAdminMfaPolicyState.REQUIRED);
    assert.equal(policy.enforced, true);
    assert.equal(policy.failureReason, null);
  });
}

test("explicit false is accurately disabled only outside production", () => {
  const policy = resolveHumanAdminMfaPolicy({ rawValue: " FALSE ", runtimeEnvironment: "development" });
  assert.equal(policy.state, HumanAdminMfaPolicyState.DISABLED);
  assert.equal(policy.enforced, false);
  assert.equal(policy.allowsWithoutAuthority, true);
  assert.equal(policy.failureReason, null);
});

test("explicit false cannot disable production MFA", () => {
  const policy = resolveHumanAdminMfaPolicy({ rawValue: "false", runtimeEnvironment: "production" });
  assert.equal(policy.state, HumanAdminMfaPolicyState.DISABLED);
  assert.equal(policy.enforced, true);
  assert.equal(policy.allowsWithoutAuthority, false);
  assert.equal(policy.failureReason, "custom_mfa_disabled_in_production");
});

test("policy results are immutable", () => {
  assert.equal(Object.isFrozen(resolveHumanAdminMfaPolicy({ rawValue: "true" })), true);
});
