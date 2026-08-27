import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const VALID_RELEASE_TYPES = new Set(["single", "feature", "album", "ep", "mixtape"]);
const MULTI_TRACK_TYPES = new Set(["album", "ep", "mixtape"]);

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
  const [{ data: release }, { data: existingSnapshot }] = await Promise.all([
    admin.from("releases").select("id,status,metadata,release_type,release_date,cover_art_r2_key").eq("id", id).maybeSingle(),
    admin.from("release_drafts").select("draft_payload").eq("release_id", id).maybeSingle(),
  ]);
  if (!release) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (release.status !== "draft") return NextResponse.json({ error: "Published releases cannot be overwritten as drafts" }, { status: 409 });

  // Merge onto the previously-saved snapshot rather than blind-replacing it. The
  // wizard always sends its full accumulated `data`/`tracks` object today, but this
  // route has no way to guarantee that of every caller — an incomplete or
  // out-of-order-arriving payload must never be able to erase fields a prior save
  // already persisted (a stale request finishing after a newer one is exactly this
  // shape). Top-level keys in the incoming payload win; anything it omits falls back
  // to what's already stored.
  const priorPayload = existingSnapshot?.draft_payload || {};
  const priorData = priorPayload.data || {};
  const mergedPayload = {
    ...priorPayload,
    ...payload,
    data: { ...priorData, ...(payload.data || {}) },
    tracks: Array.isArray(payload.tracks) ? payload.tracks : (priorPayload.tracks || []),
  };
  const data = mergedPayload.data || {};

  // Reject a release-type change that would leave already-uploaded tracks in
  // a shape the new type's wizard steps never walked through — e.g. Single
  // (one implicit track) -> EP (a real tracklist), or the reverse. Changing
  // between two multi-track types (Album/EP/Mixtape) or two single-track
  // types (Single/Feature) is harmless and stays allowed.
  const requestedType = data.release_type;
  if (requestedType && requestedType !== release.release_type) {
    if (!VALID_RELEASE_TYPES.has(requestedType)) {
      return NextResponse.json({ error: `"${requestedType}" is not a valid release type` }, { status: 422 });
    }
    const oldIsMultiTrack = MULTI_TRACK_TYPES.has(release.release_type);
    const newIsMultiTrack = MULTI_TRACK_TYPES.has(requestedType);
    if (oldIsMultiTrack !== newIsMultiTrack) {
      const { count } = await admin
        .from("tracks")
        .select("id", { count: "exact", head: true })
        .eq("release_id", id);
      if (count > 0) {
        return NextResponse.json({
          error: `Cannot change release type from "${release.release_type}" to "${requestedType}" — ${count} track${count === 1 ? "" : "s"} already uploaded for this draft. Remove the existing track(s) first, then change the type.`,
        }, { status: 409 });
      }
    }
  }

  const savedAt = new Date().toISOString();
  const { error } = await admin.from("release_drafts").upsert({
    release_id: id,
    draft_payload: mergedPayload,
    step_index: stepIndex,
    saved_at: savedAt,
    updated_at: savedAt,
  }, { onConflict: "release_id" });
  if (error) return NextResponse.json({ error: `Failed to save draft: ${error.message}` }, { status: 500 });

  // Keep list-card metadata and asset references queryable without unpacking the snapshot.
  // Fields absent from THIS save fall back to the release's current stored value —
  // never to null — so a step that doesn't happen to carry a previously-set field
  // (e.g. the wizard resending state from a stale render) can't silently clear it.
  await admin.from("releases").update({
    release_type: data.release_type || release.release_type,
    release_date: data.release_date ?? release.release_date,
    cover_art_r2_key: data.cover_key ?? release.cover_art_r2_key,
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
