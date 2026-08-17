import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function PATCH(req, { params }) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit(req, { routeKey: "playlists.update", limit: 60, windowSeconds: 60, identifier: user.id });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const patch = { updated_at: new Date().toISOString() };
  if (body.title !== undefined) patch.title = String(body.title).trim().slice(0, 200) || "New Playlist";
  if (body.artwork !== undefined) patch.artwork_url = body.artwork || null;
  if (body.sortOrder !== undefined) patch.sort_order = Number(body.sortOrder) || 0;

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_playlists")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ playlist: { id: data.id, title: data.title, artwork: data.artwork_url, updatedAt: data.updated_at } });
}

export async function DELETE(req, { params }) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit(req, { routeKey: "playlists.delete", limit: 30, windowSeconds: 60, identifier: user.id });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const { id } = await params;
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_playlists")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
