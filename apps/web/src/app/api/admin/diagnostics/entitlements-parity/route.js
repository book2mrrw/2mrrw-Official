import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildEntitlementsParityReport } from "@/lib/commerce/entitlements-parity";

function authorize(request) {
  const secret = request.headers.get("x-admin-seed-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(process.env.ADMIN_SEED_SECRET && secret === process.env.ADMIN_SEED_SECRET);
}

export async function GET(request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const report = await buildEntitlementsParityReport(admin);
    return NextResponse.json({ data: report });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Parity diagnostics failed", generatedAt: new Date().toISOString() },
      { status: 500 }
    );
  }
}
