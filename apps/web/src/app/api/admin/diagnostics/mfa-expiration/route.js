import { NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Controlled, non-destructive proof that expired durable MFA state is rejected. */
export async function POST() {
  const actor = await requireAdminActor();
  if (!actor.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await getAdminClient().rpc("certify_2mrrw_mfa_expiration", {
    p_user_id: actor.user.id,
  });
  if (error) {
    console.error("[mfa-expiration-certification] RPC failed", error.message);
    return NextResponse.json({ error: "Expiration certification failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: data === true, expiredAuthorityDenied: data === true }, {
    status: data === true ? 200 : 500,
    headers: { "Cache-Control": "no-store" },
  });
}
