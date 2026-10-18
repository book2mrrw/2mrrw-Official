import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";

export const dynamic = "force-dynamic";

/**
 * Remove a track from one release without deleting its track row, master audio,
 * replacement history, visuals, HLS outputs, or rights identity. The database
 * function updates the release association and compacts positions atomically.
 */
export async function DELETE(req, { params }) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.tracks.delete",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id: releaseOrProductId, trackId } = await params;
  if (!releaseOrProductId || !trackId) {
    return NextResponse.json({ error: "Release ID and track ID are required" }, { status: 400 });
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(releaseOrProductId) || !uuidPattern.test(trackId)) {
    return NextResponse.json({ error: "Release ID and track ID must be valid IDs" }, { status: 400 });
  }

  const admin = getAdminClient();
  const [releaseResult, productResult] = await Promise.all([
    admin.from("releases").select("id, slug, release_type, status").eq("id", releaseOrProductId).maybeSingle(),
    admin.from("products").select("id, slug, release_id, product_type, release_type, active").eq("id", releaseOrProductId).maybeSingle(),
  ]);
  if (releaseResult.error) {
    return NextResponse.json({ error: "Could not verify the release" }, { status: 500 });
  }
  if (productResult.error) {
    return NextResponse.json({ error: "Could not verify the catalog release" }, { status: 500 });
  }
  const release = releaseResult.data;
  const product = productResult.data;
  if (!release && !product) return NextResponse.json({ error: "Release not found" }, { status: 404 });

  const result = await admin.rpc("remove_release_track", {
    p_release_or_product_id: releaseOrProductId,
    p_track_id: trackId,
  });
  if (result.error) {
    console.error("[admin/releases/tracks] removal RPC failed", result.error.message);
    return NextResponse.json({ error: "Track removal failed; no track or media was deleted" }, { status: 500 });
  }

  const outcome = result.data;
  if (!outcome?.ok) {
    const status = outcome?.code === "release_not_found" || outcome?.code === "track_not_in_release" ? 404 : 409;
    const messages = {
      release_not_found: "Release not found",
      track_not_in_release: "This track is no longer part of the release",
      multi_track_release_required: "Tracks can only be removed from multi-track releases",
      last_track: "A live release must keep at least one track",
    };
    return NextResponse.json({ error: messages[outcome?.code] || "Track could not be removed" }, { status });
  }

  const releaseSlug = release?.slug || product?.slug;
  const releaseType = release?.release_type || product?.release_type || product?.product_type;
  if (release?.status !== "draft" && (release || product?.active)) {
    revalidateStorefront(releaseSlug, releaseType);
  }

  return NextResponse.json({ ok: true, removed: trackId, removedAt: outcome.removed_at });
}
