import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getAdminClient } from "@/lib/supabase/admin";
import { playlistWriteGateResponse } from "@/lib/playlists/write-gate";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

import { toClientPlaylist } from "@/lib/playlists/identity";

export async function GET(req) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit(req, { routeKey: "playlists.list", limit: 60, windowSeconds: 60, identifier: user.id });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const admin = getAdminClient();
  const { data: rows, error: plErr } = await admin
    .from("user_playlists")
    .select("*")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true }).order("id", { ascending: true });

  if (plErr) return NextResponse.json({ error: plErr.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ playlists: [] });

  const { data: trackRows, error: trErr } = await admin
    .from("playlist_tracks")
    .select("*")
    .in("playlist_id", rows.map((p) => p.id))
    .order("sort_order", { ascending: true }).order("id", { ascending: true });

  if (trErr) return NextResponse.json({ error: trErr.message }, { status: 500 });

  const byPlaylist = {};
  for (const t of trackRows || []) {
    if (!byPlaylist[t.playlist_id]) byPlaylist[t.playlist_id] = [];
    byPlaylist[t.playlist_id].push(t);
  }

  return NextResponse.json({ playlists: rows.map((pl) => toClientPlaylist(pl, byPlaylist[pl.id] || [])) });
}

export async function POST(req) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit(req, { routeKey: "playlists.create", limit: 30, windowSeconds: 60, identifier: user.id });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const gated = playlistWriteGateResponse();
  if (gated) return gated;
  const body = await req.json().catch(() => ({}));
  const { id, title, artwork, isSystem = false, sortOrder = 0 } = body;

  const admin = getAdminClient();
  const row = {
    user_id: user.id,
    title: String(title || "New Playlist").trim().slice(0, 200) || "New Playlist",
    artwork_url: artwork || null,
    is_system: Boolean(isSystem),
    sort_order: Number(sortOrder) || 0,
  };
  if (id) row.id = id;

  const { data, error } = await admin.from("user_playlists").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    playlist: toClientPlaylist(data, []),
  });
}
