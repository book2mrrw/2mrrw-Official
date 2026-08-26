import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decryptAccountExport, encryptAccountExport } from "@/lib/account-lifecycle/export-crypto";
import { runAccountLifecycleBatch } from "@/lib/account-lifecycle/worker";

test("F0-LIFE-B1 envelope encryption round-trips and rejects ciphertext tampering", () => {
  const previousKey = process.env.ACCOUNT_EXPORT_KEK_BASE64;
  const previousVersion = process.env.ACCOUNT_EXPORT_KEK_VERSION;
  process.env.ACCOUNT_EXPORT_KEK_BASE64 = randomBytes(32).toString("base64");
  process.env.ACCOUNT_EXPORT_KEK_VERSION = "test-v1";
  try {
    const requestId = "00000000-0000-4000-8000-000000000001";
    const plaintext = Buffer.from("private account export\n");
    const encrypted = encryptAccountExport({ requestId, plaintext });
    const decrypted = decryptAccountExport({ requestId, envelope: encrypted.envelope,
      wrappedDataKey: encrypted.wrappedDataKey, keyVersion: encrypted.keyVersion });
    assert.deepEqual(decrypted, plaintext);
    const tampered = Buffer.from(encrypted.envelope);
    tampered[tampered.length - 1] ^= 1;
    assert.throws(() => decryptAccountExport({ requestId, envelope: tampered,
      wrappedDataKey: encrypted.wrappedDataKey, keyVersion: encrypted.keyVersion }));
  } finally {
    if (previousKey === undefined) delete process.env.ACCOUNT_EXPORT_KEK_BASE64;
    else process.env.ACCOUNT_EXPORT_KEK_BASE64 = previousKey;
    if (previousVersion === undefined) delete process.env.ACCOUNT_EXPORT_KEK_VERSION;
    else process.env.ACCOUNT_EXPORT_KEK_VERSION = previousVersion;
  }
});

function fakeAdmin(claims) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_account_lifecycle_step") return { data: claims.length ? [claims.shift()] : [], error: null };
      return { data: true, error: null };
    },
  };
}

const claim = (step = "work") => ({ request_id: "r1", user_id: "u1", kind: "delete",
  step_key: step, attempt_count: 1, lease_token: "lease1", correlation_id: "c1" });

test("F0-LIFE-B2 completed, deferred, and failed outcomes use distinct fenced RPCs", async () => {
  const completedAdmin = fakeAdmin([claim()]);
  await runAccountLifecycleBatch({ admin: completedAdmin, handlers: { work: async () => ({ status: "completed", result: { ok: true } }) } });
  assert.ok(completedAdmin.calls.some((call) => call.name === "finish_account_lifecycle_step"));

  const deferredAdmin = fakeAdmin([claim()]);
  await runAccountLifecycleBatch({ admin: deferredAdmin, handlers: { work: async () => ({ status: "deferred",
    resumeAt: "2099-01-01T00:00:00.000Z", reason: "deadline" }) } });
  assert.ok(deferredAdmin.calls.some((call) => call.name === "defer_account_lifecycle_step"));
  assert.ok(!deferredAdmin.calls.some((call) => call.name === "finish_account_lifecycle_step"));

  const failedAdmin = fakeAdmin([claim()]);
  await runAccountLifecycleBatch({ admin: failedAdmin, handlers: { work: async () => { throw Object.assign(new Error("boom"), { code: "simulated" }); } } });
  assert.ok(failedAdmin.calls.some((call) => call.name === "retry_account_lifecycle_step"));
});

test("F0-LIFE-B3 missing processors retry and batches obey their work bound", async () => {
  const missingAdmin = fakeAdmin([claim("unknown")]);
  const missing = await runAccountLifecycleBatch({ admin: missingAdmin, handlers: {} });
  assert.equal(missing.results[0].errorCode, "processor_not_registered");

  const boundedAdmin = fakeAdmin(Array.from({ length: 30 }, () => claim()));
  const bounded = await runAccountLifecycleBatch({ admin: boundedAdmin,
    handlers: { work: async () => ({ status: "completed" }) }, maxSteps: 3 });
  assert.equal(bounded.processed, 3);
});
