import { randomUUID } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";

const DEFAULT_MAX_STEPS = 10;
const DEFAULT_TIME_BUDGET_MS = 40_000;

function errorCode(error) {
  const value = error?.code || error?.name || "processor_error";
  return String(value).toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 128);
}

async function finish(admin, claim, outcome) {
  const { data, error } = await admin.rpc("finish_account_lifecycle_step", {
    p_request_id: claim.request_id,
    p_step_key: claim.step_key,
    p_lease_token: claim.lease_token,
    p_result: outcome?.result || {},
    p_skipped: outcome?.status === "skipped",
  });
  if (error) throw error;
  if (data !== true) throw Object.assign(new Error("Lifecycle lease was lost before completion"), { code: "lease_lost" });
}

async function retry(admin, claim, error) {
  const { data, error: rpcError } = await admin.rpc("retry_account_lifecycle_step", {
    p_request_id: claim.request_id,
    p_step_key: claim.step_key,
    p_lease_token: claim.lease_token,
    p_error_code: errorCode(error),
  });
  if (rpcError) throw rpcError;
  return data === true;
}

async function defer(admin, claim, outcome) {
  const { data, error } = await admin.rpc("defer_account_lifecycle_step", {
    p_request_id: claim.request_id, p_step_key: claim.step_key,
    p_lease_token: claim.lease_token, p_resume_at: outcome.resumeAt,
    p_reason: outcome.reason || "scheduled",
  });
  if (error) throw error;
  if (data !== true) throw Object.assign(new Error("Lifecycle lease was lost before deferral"), { code: "lease_lost" });
}

export async function runAccountLifecycleBatch({
  admin = getAdminClient(),
  handlers,
  workerId = `account-lifecycle-${randomUUID()}`,
  maxSteps = DEFAULT_MAX_STEPS,
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
  now = () => Date.now(),
} = {}) {
  if (!handlers || typeof handlers !== "object") throw new Error("Lifecycle handler registry is required");
  const boundedSteps = Math.min(Math.max(Number(maxSteps) || 1, 1), 25);
  const boundedBudget = Math.min(Math.max(Number(timeBudgetMs) || 1_000, 1_000), 50_000);
  const startedAt = now();
  const results = [];

  while (results.length < boundedSteps && now() - startedAt < boundedBudget) {
    const { data, error } = await admin.rpc("claim_account_lifecycle_step", {
      p_worker_id: workerId,
      p_lease_seconds: 120,
    });
    if (error) throw error;
    const claim = Array.isArray(data) ? data[0] : data;
    if (!claim) break;

    const handler = handlers[claim.step_key];
    if (typeof handler !== "function") {
      const missing = Object.assign(new Error(`No processor registered for ${claim.step_key}`), {
        code: "processor_not_registered",
      });
      await retry(admin, claim, missing);
      results.push({ requestId: claim.request_id, step: claim.step_key, status: "retry", errorCode: missing.code });
      continue;
    }

    try {
      const outcome = await handler({ admin, claim, workerId });
      if (!outcome || !["completed", "skipped", "deferred", "committed"].includes(outcome.status)) {
        throw Object.assign(new Error("Processor returned an invalid outcome"), { code: "invalid_processor_outcome" });
      }
      if (outcome.status === "deferred") await defer(admin, claim, outcome);
      else if (outcome.status === "committed") { /* processor atomically committed its terminal state */ }
      else await finish(admin, claim, outcome);
      results.push({ requestId: claim.request_id, step: claim.step_key, status: outcome.status });
    } catch (processorError) {
      await retry(admin, claim, processorError);
      results.push({ requestId: claim.request_id, step: claim.step_key, status: "retry", errorCode: errorCode(processorError) });
    }
  }

  return { workerId, processed: results.length, elapsedMs: now() - startedAt, results };
}
