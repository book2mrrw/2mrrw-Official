import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

async function verifyOwnership(admin, playlistId, userId) {
  const { data } = await admin
    .from("user_playlists")
    .select("id")
    .eq("id", playlistId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

// POST — add a track
export async function POST(req, { params }) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit(req, { routeKey: "playlists.tracks.add", limit: 120, windowSeconds: 60, identifier: user.id });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const { id: playlistId } = await params;
  const body = await req.json().catch(() => ({}));
  const { trackSlug, albumSlug, trackData, sortOrder } = body;
  if (!trackSlug) return NextResponse.json({ error: "trackSlug required" }, { status: 400 });

  const admin = getAdminClient();
  if (!(await verifyOwnership(admin, playlistId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await admin.from("playlist_tracks").upsert(
    {
      playlist_id: playlistId,
      track_slug: trackSlug,
      album_slug: albumSlug || null,
      track_data: trackData || null,
      sort_order: Number(sortOrder) || 0,
    },
    { onConflict: "playlist_id,track_slug" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin
    .from("user_playlists")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", playlistId);

  return NextResponse.json({ ok: true });
}

// PUT — reorder tracks (body: { trackIds: string[] })
export async function PUT(req, { params }) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit(req, { routeKey: "playlists.tracks.reorder", limit: 60, windowSeconds: 60, identifier: user.id });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const { id: playlistId } = await params;
  const body = await req.json().catch(() => ({}));
  const { trackIds } = body;
  if (!Array.isArray(trackIds)) return NextResponse.json({ error: "trackIds array required" }, { status: 400 });

  const admin = getAdminClient();
  if (!(await verifyOwnership(admin, playlistId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await Promise.all(
    trackIds.map((slug, index) =>
      admin
        .from("playlist_tracks")
        .update({ sort_order: index })
        .eq("playlist_id", playlistId)
        .eq("track_slug", slug)
    )
  );

  return NextResponse.json({ ok: true });
}

// DELETE — remove a track (body: { trackKey: string })
export async function DELETE(req, { params }) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit(req, { routeKey: "playlists.tracks.remove", limit: 120, windowSeconds: 60, identifier: user.id });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const { id: playlistId } = await params;
  const body = await req.json().catch(() => ({}));
  const { trackKey } = body;
  if (!trackKey) return NextResponse.json({ error: "trackKey required" }, { status: 400 });

  const admin = getAdminClient();
  if (!(await verifyOwnership(admin, playlistId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await admin
    .from("playlist_tracks")
    .delete()
    .eq("playlist_id", playlistId)
    .eq("track_slug", trackKey);

  await admin
    .from("user_playlists")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", playlistId);

  return NextResponse.json({ ok: true });
}
