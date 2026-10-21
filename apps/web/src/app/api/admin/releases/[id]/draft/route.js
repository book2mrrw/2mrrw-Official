import { loadEditableRelease } from "@/lib/credits/admin-store";
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";


async function authorize() {
  const user = await getAdminSessionUser();
  return user && isAdminUser(user) ? user : null;
}

export async function GET(_req, { params }) {
  if (!await authorize()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const admin = getAdminClient();
  const [{ data: release, error: releaseError }, { data: snapshot, error: snapshotError }] = await Promise.all([
    admin.from("releases").select("id,slug,status,release_type,cover_art_r2_key,metadata").is("deleted_at", null).eq("id", id).single(),
    admin.from("release_drafts").select("draft_payload,step_index,saved_at").eq("release_id", id).order("saved_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (releaseError || !release) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (release.status !== "draft") return NextResponse.json({ error: "Only drafts can be resumed" }, { status: 409 });
  if (snapshotError) return NextResponse.json({ error: "Failed to load draft snapshot" }, { status: 500 });
  try {
    const detail = await loadEditableRelease(admin, id);
    return NextResponse.json({ release, snapshot: snapshot || null, detail });
  } catch {
    return NextResponse.json({ error: "Failed to load saved draft metadata" }, { status: 503 });
  }
}

export async function PUT(req, { params }) {
  const user = await authorize();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const stepIndex = Number.isInteger(body.step_index) ? Math.max(0, body.step_index) : 0;
  const payload = body.draft_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return NextResponse.json({ error: "draft_payload is required" }, { status: 400 });

  // Draft snapshots retain unfinished form input; canonical allocations are validated when publishing.
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("save_release_credit_draft", {
    p_release_id: id,
    p_expected_saved_at: body.expected_saved_at || null,
    p_payload: payload,
    p_step_index: stepIndex,
  });
  if (error) return NextResponse.json({ error: error.code === "40001" ? "This draft changed in another editor. Reopen it before saving; your entered data is retained locally." : error.code === "22023" ? error.message : "Draft could not be saved" }, { status: error.code === "40001" ? 409 : error.code === "22023" ? 422 : 503 });
  return NextResponse.json({ ok: true, saved_at: data.saved_at });
}
