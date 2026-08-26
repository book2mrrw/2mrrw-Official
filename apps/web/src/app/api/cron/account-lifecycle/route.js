import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { accountLifecycleProcessors } from "@/lib/account-lifecycle/processors";
import { runAccountLifecycleBatch } from "@/lib/account-lifecycle/worker";
import { emitServerEvent } from "@/lib/observability/server-events";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") || "";
  const expected = secret ? `Bearer ${secret}` : "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return Boolean(secret) && left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (process.env.ACCOUNT_LIFECYCLE_EXECUTION_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, processed: 0 });
  }

  try {
    const result = await runAccountLifecycleBatch({ handlers: accountLifecycleProcessors });
    emitServerEvent("info", "account_lifecycle_batch_completed", {
      workerId: result.workerId, processed: result.processed, elapsedMs: result.elapsedMs,
      outcomes: result.results.map(({ step, status, errorCode }) => ({ step, status, errorCode })),
    });
    return NextResponse.json({ enabled: true, ...result });
  } catch (error) {
    emitServerEvent("error", "account_lifecycle_coordinator_failed", { code: errorCode(error) }, error);
    return NextResponse.json({ error: "Lifecycle coordinator unavailable" }, { status: 503 });
  }
}

function errorCode(error) {
  return String(error?.code || error?.name || "unknown").slice(0, 128);
}
