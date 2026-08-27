import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { deleteR2Object } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

// Deleting a track the admin removed in the wizard was previously client-only
// — the tracks row survived, and publish loads every DB row for the release
// regardless of what the client currently submits, so a removed track could
// silently reappear in a published release. This route makes removal
// authoritative. Scoped to draft releases only: removing a track from an
// already-published, multi-track release has additional consequences
// (catalog_tracks cleanup, position renumbering on the live storefront, HLS
// job teardown) that are a distinct, larger operation, not this bug fix.
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

  const { id: releaseId, trackId } = await params;
  if (!releaseId || !trackId) {
    return NextResponse.json({ error: "Release ID and track ID are required" }, { status: 400 });
  }

  const admin = getAdminClient();

  const { data: release } = await admin
    .from("releases")
    .select("id, status, slug")
    .eq("id", releaseId)
    .maybeSingle();
  if (!release) return NextResponse.json({ error: "Release not found" }, { status: 404 });
  if (release.status !== "draft") {
    return NextResponse.json(
      { error: "Only tracks on a draft release can be removed this way" },
      { status: 409 }
    );
  }

  const { data: track, error: trackErr } = await admin
    .from("tracks")
    .select("id, audio_r2_key, master_r2_key")
    .eq("id", trackId)
    .eq("release_id", releaseId)
    .maybeSingle();
  if (trackErr) return NextResponse.json({ error: trackErr.message }, { status: 500 });
  if (!track) {
    // Already gone — deleting a track that doesn't exist is a safe no-op.
    return NextResponse.json({ ok: true, deleted: trackId, alreadyRemoved: true });
  }

  const { error: deleteErr } = await admin.from("tracks").delete().eq("id", trackId);
  if (deleteErr) {
    return NextResponse.json({ error: `Failed to remove track: ${deleteErr.message}` }, { status: 500 });
  }

  // Best-effort R2 cleanup — non-fatal. A track's audio keys are not shared
  // with any other row, but check anyway before deleting, defensively.
  const candidateKeys = [track.audio_r2_key, track.master_r2_key].filter(Boolean);
  for (const key of new Set(candidateKeys)) {
    try {
      const { data: stillReferenced } = await admin
        .from("tracks")
        .select("id")
        .or(`audio_r2_key.eq.${key},master_r2_key.eq.${key}`)
        .limit(1)
        .maybeSingle();
      if (!stillReferenced) await deleteR2Object(key);
    } catch {
      // Storage cleanup is supplementary — the authoritative DB row is
      // already gone, which is what matters for publish correctness.
    }
  }

  await admin.from("hls_transcode_jobs").delete().eq("source_key", track.audio_r2_key).catch(() => {});

  return NextResponse.json({ ok: true, deleted: trackId });
}
