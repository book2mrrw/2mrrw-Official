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
    admin.from("releases").select("id,slug,status,release_type,cover_art_r2_key,metadata").eq("id", id).single(),
    admin.from("release_drafts").select("draft_payload,step_index,saved_at").eq("release_id", id).maybeSingle(),
  ]);
  if (releaseError || !release) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (release.status !== "draft") return NextResponse.json({ error: "Only drafts can be resumed" }, { status: 409 });
  if (snapshotError) return NextResponse.json({ error: "Failed to load draft snapshot" }, { status: 500 });
  return NextResponse.json({ release, snapshot: snapshot || null });
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

  const admin = getAdminClient();
  const { data: release } = await admin.from("releases").select("id,status,metadata").eq("id", id).maybeSingle();
  if (!release) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (release.status !== "draft") return NextResponse.json({ error: "Published releases cannot be overwritten as drafts" }, { status: 409 });

  const savedAt = new Date().toISOString();
  const { error } = await admin.from("release_drafts").upsert({
    release_id: id,
    draft_payload: payload,
    step_index: stepIndex,
    saved_at: savedAt,
    updated_at: savedAt,
  }, { onConflict: "release_id" });
  if (error) return NextResponse.json({ error: `Failed to save draft: ${error.message}` }, { status: 500 });

  // Keep list-card metadata and asset references queryable without unpacking the snapshot.
  const data = payload.data || {};
  await admin.from("releases").update({
    release_type: data.release_type || release.release_type,
    release_date: data.release_date || null,
    cover_art_r2_key: data.cover_key || null,
    metadata: {
      ...(release.metadata || {}),
      draft_title: data.title || null,
      draft_genre_id: data.genre_id || null,
      draft_subgenre_ids: data.subgenre_ids || [],
      draft_secondary_genre_ids: data.secondary_genre_ids || [],
      draft_price: data.price || null,
      draft_step_index: stepIndex,
      animated_cover_r2_key: data.cover_video_key || null,
    },
  }).eq("id", id);
  return NextResponse.json({ ok: true, saved_at: savedAt });
}
