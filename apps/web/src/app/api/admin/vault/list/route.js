import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { folderForCategory, VISIBILITIES } from "@/lib/vault/vault-upload-contract";

export const dynamic = "force-dynamic";

/** Everything in a section, drafts included -- this is the admin's view, not
 *  the public one, so it deliberately ignores entitlement filtering. */
export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const category = new URL(req.url).searchParams.get("category");
  const admin = getAdminClient();
  let query = admin
    .from("vault_content")
    .select("id, slug, category, title, description, media_type, access_tier, visibility, media_storage_path, duration_seconds, sort_order, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (category) {
    if (!folderForCategory(category)) {
      return NextResponse.json({ error: "Unknown vault section" }, { status: 400 });
    }
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) {
    console.error("vault list failed:", error);
    return NextResponse.json({ error: "Could not load vault entries" }, { status: 500 });
  }
  return NextResponse.json({ items: data || [] });
}

/** Flip visibility. Publishing stamps published_at the first time so the
 *  public feed has something honest to sort on. */
export async function PATCH(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.visibility",
    limit: 60,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, visibility } = body || {};
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (!VISIBILITIES.includes(visibility)) {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }

  const admin = getAdminClient();
  const patch = { visibility, updated_at: new Date().toISOString() };
  if (visibility === "published") patch.published_at = new Date().toISOString();

  const { data, error } = await admin
    .from("vault_content")
    .update(patch)
    .eq("id", id)
    .select("id, slug, visibility, published_at")
    .maybeSingle();

  if (error) {
    console.error("vault visibility update failed:", error);
    return NextResponse.json({ error: "Could not update visibility" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, item: data });
}
