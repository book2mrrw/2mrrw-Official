import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.list",
    limit: 60,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();

  const { data: releases, error } = await admin
    .from("releases")
    .select("id, slug, status, release_type, release_date, storefront_visible, scheduled_at, cover_art_r2_key, upc, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // For each release, get product title + track count
  const releaseIds = (releases || []).map((r) => r.id);

  const [productsRes, tracksRes] = await Promise.all([
    admin
      .from("products")
      .select("release_id, title, active")
      .in("release_id", releaseIds),
    admin
      .from("tracks")
      .select("release_id, upload_status")
      .in("release_id", releaseIds),
  ]);

  const productsByRelease = {};
  for (const p of (productsRes.data || [])) {
    productsByRelease[p.release_id] = p;
  }

  const trackCountByRelease = {};
  for (const t of (tracksRes.data || [])) {
    if (!trackCountByRelease[t.release_id]) {
      trackCountByRelease[t.release_id] = { total: 0, ready: 0 };
    }
    trackCountByRelease[t.release_id].total++;
    if (t.upload_status === "ready") trackCountByRelease[t.release_id].ready++;
  }

  const enriched = (releases || []).map((r) => ({
    ...r,
    title:        productsByRelease[r.id]?.title || null,
    product_active: productsByRelease[r.id]?.active || false,
    track_counts: trackCountByRelease[r.id] || { total: 0, ready: 0 },
  }));

  return NextResponse.json({ releases: enriched });
}
