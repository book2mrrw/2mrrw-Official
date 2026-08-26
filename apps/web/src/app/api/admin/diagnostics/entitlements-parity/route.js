import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { buildEntitlementsParityReport } from "@/lib/commerce/entitlements-parity";
import { requireServiceCapability, ServiceCapability } from "@/lib/auth/admin-api-guard";

function authorize(request) {
  return requireServiceCapability(request, ServiceCapability.DIAGNOSTICS_READ).ok;
}

export async function GET(request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = getAdminClient();
    const report = await buildEntitlementsParityReport(admin);
    return NextResponse.json({ data: report });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Parity diagnostics failed", generatedAt: new Date().toISOString() },
      { status: 500 }
    );
  }
}
