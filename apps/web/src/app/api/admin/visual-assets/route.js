import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  VISUAL_ASSET_TYPES,
  VISUAL_PLAYBACK_MODES,
  VISUAL_INTERACTIONS,
  VISUAL_ENTITLEMENT_TIERS,
} from "@/lib/media/visual-asset-schema";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "book2mrrw@gmail.com").toLowerCase();

async function requireAdmin(cookieStore) {
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) return null;
  return sb;
}

/**
 * GET /api/admin/visual-assets?release_slug=<slug>
 * Returns all (including inactive) visual assets for a release.
 */
export async function GET(req) {
  const cookieStore = await cookies();
  const sb = await requireAdmin(cookieStore);
  if (!sb) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const releaseSlug = req.nextUrl.searchParams.get("release_slug");
  if (!releaseSlug) return NextResponse.json({ error: "release_slug required" }, { status: 400 });

  const { data, error } = await sb
    .from("release_visual_assets")
    .select("*")
    .eq("release_slug", releaseSlug)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assets: data ?? [] });
}

/**
 * POST /api/admin/visual-assets
 * Create a new visual asset row.
 */
export async function POST(req) {
  const cookieStore = await cookies();
  const sb = await requireAdmin(cookieStore);
  if (!sb) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body?.release_slug || !body?.asset_type) {
    return NextResponse.json({ error: "release_slug and asset_type required" }, { status: 400 });
  }

  if (!VISUAL_ASSET_TYPES.includes(body.asset_type)) {
    return NextResponse.json({ error: `Invalid asset_type. Valid: ${VISUAL_ASSET_TYPES.join(", ")}` }, { status: 400 });
  }
  if (body.playback_mode && !VISUAL_PLAYBACK_MODES.includes(body.playback_mode)) {
    return NextResponse.json({ error: `Invalid playback_mode` }, { status: 400 });
  }
  if (body.interaction && !VISUAL_INTERACTIONS.includes(body.interaction)) {
    return NextResponse.json({ error: `Invalid interaction` }, { status: 400 });
  }
  if (body.entitlement && !VISUAL_ENTITLEMENT_TIERS.includes(body.entitlement)) {
    return NextResponse.json({ error: `Invalid entitlement` }, { status: 400 });
  }

  const insert = {
    release_slug:   body.release_slug,
    track_slug:     body.track_slug     ?? null,
    asset_type:     body.asset_type,
    playback_mode:  body.playback_mode  ?? "synced",
    interaction:    body.interaction    ?? "hold",
    sync_offset:    body.sync_offset    ?? 0,
    entitlement:    body.entitlement    ?? "public",
    r2_key:         body.r2_key         ?? null,
    hls_slug:       body.hls_slug       ?? null,
    poster_r2_key:  body.poster_r2_key  ?? null,
    thumbnail_url:  body.thumbnail_url  ?? null,
    duration_seconds: body.duration_seconds ?? null,
    priority:       body.priority       ?? 0,
    active:         body.active         ?? true,
    publish_at:     body.publish_at     ?? null,
    expires_at:     body.expires_at     ?? null,
    title:          body.title          ?? null,
    description:    body.description    ?? null,
    metadata:       body.metadata       ?? null,
  };

  const { data, error } = await sb.from("release_visual_assets").insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ asset: data }, { status: 201 });
}

/**
 * PATCH /api/admin/visual-assets?id=<uuid>
 * Update an existing visual asset row (partial update).
 */
export async function PATCH(req) {
  const cookieStore = await cookies();
  const sb = await requireAdmin(cookieStore);
  if (!sb) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "No body" }, { status: 400 });

  const allowed = [
    "asset_type","playback_mode","interaction","sync_offset","entitlement",
    "r2_key","hls_slug","poster_r2_key","thumbnail_url","duration_seconds",
    "priority","active","publish_at","expires_at","title","description","metadata",
    "track_slug",
  ];
  const patch = {};
  for (const k of allowed) { if (k in body) patch[k] = body[k]; }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No patchable fields provided" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("release_visual_assets")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ asset: data });
}

/**
 * DELETE /api/admin/visual-assets?id=<uuid>
 * Hard-delete a visual asset row.
 */
export async function DELETE(req) {
  const cookieStore = await cookies();
  const sb = await requireAdmin(cookieStore);
  if (!sb) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await sb.from("release_visual_assets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
