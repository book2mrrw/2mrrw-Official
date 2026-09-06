import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { syncPrintfulCatalog } from "@/lib/fulfillment/sync-printful-catalog";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.printful.sync",
    limit: 10,
    windowSeconds: 300,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  try {
    const summary = await syncPrintfulCatalog();
    revalidateStorefront();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[admin/printful/sync] failed", err.message);
    return NextResponse.json({ error: err.message || "Sync failed" }, { status: 500 });
  }
}
