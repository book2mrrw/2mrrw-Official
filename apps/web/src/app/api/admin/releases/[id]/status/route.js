import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Release ID required" }, { status: 400 });

  const admin = getAdminClient();

  const [releaseResult, tracksResult] = await Promise.all([
    admin
      .from("releases")
      .select("id, slug, status, release_type, cover_art_r2_key, metadata, created_at, storefront_visible")
      .eq("id", id)
      .single(),
    admin
      .from("tracks")
      .select("id, slug, upload_status, audio_r2_key, master_r2_key, duration_seconds, release_id")
      .eq("release_id", id),
  ]);

  if (releaseResult.error) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  const release = releaseResult.data;
  const tracks = tracksResult.data || [];

  // Get HLS job status for all tracks in this release
  const trackSlugs = tracks.map((t) => t.slug).filter(Boolean);
  let hlsJobs = [];

  if (trackSlugs.length > 0) {
    const { data } = await admin
      .from("hls_transcode_jobs")
      .select("slug, track_slug, status, attempt_count, started_at, completed_at")
      .in("slug", trackSlugs);
    hlsJobs = data || [];
  }

  const hlsBySlug = {};
  for (const job of hlsJobs) {
    hlsBySlug[job.slug] = job;
  }

  const tracksWithHLS = tracks.map((t) => ({
    id: t.id,
    slug: t.slug,
    upload_status: t.upload_status,
    has_audio: Boolean(t.audio_r2_key),
    duration_seconds: t.duration_seconds,
    hls: hlsBySlug[t.slug] || null,
  }));

  const allAudioReady = tracksWithHLS.length > 0 && tracksWithHLS.every((t) => t.has_audio);
  const hlsComplete = tracksWithHLS.every((t) => t.hls?.status === "complete");
  const hasCover = Boolean(release.cover_art_r2_key);

  return NextResponse.json({
    release: {
      id: release.id,
      slug: release.slug,
      status: release.status,
      release_type: release.release_type,
      has_cover: hasCover,
      storefront_visible: release.storefront_visible,
      metadata: release.metadata,
    },
    tracks: tracksWithHLS,
    readiness: {
      has_audio: allAudioReady,
      has_cover: hasCover,
      hls_complete: hlsComplete,
      ready_to_publish: allAudioReady && hasCover,
    },
  });
}
