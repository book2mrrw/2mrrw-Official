import { NextResponse } from "next/server";
import { getAdminSessionUser, requireAdminActor } from "@/lib/auth/admin-api-guard";
import { classifyAdminAuthorityDenial } from "@/lib/auth/admin-authority-diagnostics";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

// PATCH — publish/unpublish. Low-stakes, reversible: the lighter session guard.
export async function PATCH(req, { params }) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.live.vods.patch",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "VOD ID required" }, { status: 400 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  if (typeof body.published !== "boolean") {
    return NextResponse.json({ error: "published (boolean) is required" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("live_broadcast_vods")
    .update({ published: body.published, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, published")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "VOD not found" }, { status: 404 });

  return NextResponse.json({ ok: true, vod: data });
}

// DELETE — permanently removes the catalog entry. Destructive: the stronger,
// MFA-recency-checked guard, same pattern as admin/releases/[id] DELETE.
export async function DELETE(req, { params }) {
  const gate = await requireAdminActor({ recentSeconds: 15 * 60 });
  if (!gate.ok) {
    const denial = classifyAdminAuthorityDenial(gate.reason);
    return NextResponse.json(
      { error: denial.status === 401 ? "Unauthorized" : "Forbidden", code: denial.code },
      { status: denial.status }
    );
  }
  const user = gate.user;

  const rl = await checkRateLimit(req, {
    routeKey: "admin.live.vods.delete",
    limit: 20,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "VOD ID required" }, { status: 400 });

  const admin = getAdminClient();
  const { error } = await admin.from("live_broadcast_vods").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: id });
}
