import { createHash } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { decryptAccountExport } from "@/lib/account-lifecycle/export-crypto";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { R2_BUCKET, r2Client } from "@/lib/storage/r2";
import { emitServerEvent } from "@/lib/observability/server-events";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const limit = await checkRateLimit(request, { routeKey: "account.export.download", limit: 5,
    windowSeconds: 3600, identifier: user.id, failureMode: "closed" });
  if (!limit.allowed) return limit.unavailable
    ? NextResponse.json({ error: "Export download is temporarily unavailable" }, { status: 503 })
    : rateLimitResponse(limit.retryAfterSeconds);
  const { requestId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(requestId || "")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const admin = getAdminClient();
  const { data: lifecycle } = await admin.from("account_lifecycle_requests").select("id,user_id,kind")
    .eq("id", requestId).eq("user_id", user.id).maybeSingle();
  if (!lifecycle || lifecycle.kind !== "export") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: artifact, error } = await admin.from("account_export_artifacts")
    .select("id,object_key,content_sha256,key_version,wrapped_data_key,expires_at,destroyed_at")
    .eq("request_id", requestId).is("destroyed_at", null).maybeSingle();
  if (error || !artifact || new Date(artifact.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Export is unavailable or expired" }, { status: 410 });
  }
  try {
    const object = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: artifact.object_key }));
    const encrypted = Buffer.from(await object.Body.transformToByteArray());
    const plaintext = decryptAccountExport({ requestId, envelope: encrypted,
      wrappedDataKey: artifact.wrapped_data_key, keyVersion: artifact.key_version });
    const digest = createHash("sha256").update(plaintext).digest("hex");
    if (digest !== artifact.content_sha256) throw Object.assign(new Error("Export digest mismatch"), { code: "export_digest_mismatch" });
    const { data: marked } = await admin.rpc("mark_account_export_delivered", { p_artifact_id: artifact.id });
    if (marked !== true) return NextResponse.json({ error: "Export expired during delivery" }, { status: 410 });
    emitServerEvent("info", "account_export_delivered", { requestId, artifactId: artifact.id, byteSize: plaintext.length });
    return new NextResponse(plaintext, { status: 200, headers: {
      "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="2mrrw-account-export-${requestId}.json.gz"`,
      "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
    } });
  } catch (downloadError) {
    emitServerEvent("error", "account_export_delivery_failed",
      { requestId, code: downloadError?.code || downloadError?.name }, downloadError);
    return NextResponse.json({ error: "Export could not be delivered" }, { status: 503 });
  }
}
