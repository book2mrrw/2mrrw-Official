import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { buildReleaseDiagnostics } from "@/lib/media/admin-media-diagnostics";
import { getCanonicalReleaseBySlug } from "@/lib/media/canonical-catalog";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slug = req.nextUrl.searchParams.get("slug");
  const trackSlug = req.nextUrl.searchParams.get("trackSlug");
  const albumSlug = req.nextUrl.searchParams.get("albumSlug");
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const canonical = getCanonicalReleaseBySlug(slug);
  const admin = getAdminClient();

  try {
    const diagnostics = await buildReleaseDiagnostics(
      canonical || { slug, release_type: req.nextUrl.searchParams.get("releaseType") || "single" },
      {
        adminClient: admin,
        trackSlug: trackSlug || undefined,
        albumSlug: albumSlug || undefined,
      }
    );
    return NextResponse.json({ data: diagnostics });
  } catch (err) {
    console.error("[admin/media-diagnostics] failed", { slug, message: err?.message });
    return NextResponse.json(
      { error: err?.message || "Diagnostics failed" },
      { status: 500 }
    );
  }
}
