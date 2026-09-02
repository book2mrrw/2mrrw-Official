import { NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";
import { classifyAdminAuthorityDenial } from "@/lib/auth/admin-authority-diagnostics";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { discoverFileByExtensions } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const gate = await requireAdminActor();
  if (!gate.ok) {
    const denial = classifyAdminAuthorityDenial(gate.reason);
    return NextResponse.json(
      {
        error: denial.status === 401 ? "Unauthorized" : "Forbidden",
        code: denial.code,
      },
      { status: denial.status, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  const user = gate.user;

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.list",
    limit: 60,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();

  // ── 1. Wizard releases (new upload system) ────────────────────────────────
  const { data: wizardReleases, error: wizardError } = await admin
    .from("releases")
    .select("id, slug, status, release_type, release_date, storefront_visible, scheduled_at, available_at, release_timezone, upcoming_visible, preview_before_release, preorder_enabled, preorder_starts_at, preorder_price_cents, early_access_enabled, early_access_starts_at, early_access_scope, early_access_audiences, published_at, unavailable_at, cover_art_r2_key, upc, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (wizardError) {
    console.error("[admin/releases] wizard releases fetch error:", wizardError.message);
  }

  const releaseIds = (wizardReleases || []).map((r) => r.id);
  const { data: pendingDumpJobs } = releaseIds.length
    ? await admin.from("draft_deletion_jobs").select("release_id").in("release_id", releaseIds).is("finalized_at", null)
    : { data: [] };
  const pendingDumpIds = new Set((pendingDumpJobs || []).map((job) => job.release_id));

  // Get product title + track counts for wizard releases
  const [wizardProductsRes, wizardTracksRes, wizardDraftsRes] = releaseIds.length > 0
    ? await Promise.all([
        admin.from("products").select("release_id, title, active, price_cents").in("release_id", releaseIds),
        admin.from("tracks").select("release_id, upload_status").in("release_id", releaseIds),
        admin.from("release_drafts").select("release_id,step_index,draft_payload,saved_at").in("release_id", releaseIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const productsByRelease = {};
  for (const p of (wizardProductsRes.data || [])) {
    productsByRelease[p.release_id] = p;
  }
  const trackCountByRelease = {};
  const draftsByRelease = Object.fromEntries((wizardDraftsRes.data || []).map((draft) => [draft.release_id, draft]));
  for (const t of (wizardTracksRes.data || [])) {
    if (!trackCountByRelease[t.release_id]) {
      trackCountByRelease[t.release_id] = { total: 0, ready: 0 };
    }
    trackCountByRelease[t.release_id].total++;
    if (t.upload_status === "ready") trackCountByRelease[t.release_id].ready++;
  }

  const enrichedWizard = (wizardReleases || []).filter((r) => !pendingDumpIds.has(r.id)).map((r) => ({
    ...r,
    title: productsByRelease[r.id]?.title || draftsByRelease[r.id]?.draft_payload?.data?.title || r.metadata?.draft_title || null,
    price_cents: productsByRelease[r.id]?.price_cents || (Number(draftsByRelease[r.id]?.draft_payload?.data?.price) * 100 || null),
    draft_step_index: draftsByRelease[r.id]?.step_index ?? r.metadata?.draft_step_index ?? null,
    draft_genre: draftsByRelease[r.id]?.draft_payload?.data?.genre || null,
    product_active: productsByRelease[r.id]?.active || false,
    track_counts: trackCountByRelease[r.id] || { total: 0, ready: 0 },
    source: "releases",
  }));

  // ── 2. Catalog releases (legacy R2-ingest system → products table) ────────
  const { data: catalogProducts, error: catalogError } = await admin
    .from("products")
    .select("id, slug, title, product_type, release_type, active, image_path, price_cents, created_at, updated_at, metadata")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (catalogError) {
    console.error("[admin/releases] catalog products fetch error:", catalogError.message);
  }

  // Track counts from catalog_tracks
  const productIds = (catalogProducts || []).map((p) => p.id);
  const { data: catalogTracksData } = productIds.length > 0
    ? await admin.from("catalog_tracks").select("product_id").in("product_id", productIds)
    : { data: [] };

  const catalogTrackCountByProduct = {};
  for (const t of (catalogTracksData || [])) {
    if (!catalogTrackCountByProduct[t.product_id]) {
      catalogTrackCountByProduct[t.product_id] = { total: 0, ready: 0 };
    }
    catalogTrackCountByProduct[t.product_id].total++;
    catalogTrackCountByProduct[t.product_id].ready++;
  }

  // Discover cover art keys for catalog products in parallel
  // image_path is stored as folder prefix (e.g. "images/singles/slug/")
  // discoverFileByExtensions finds the actual file key within that folder
  const catalogWithArt = await Promise.all(
    (catalogProducts || []).map(async (p) => {
      if (!p.image_path) return { ...p, cover_art_r2_key: null };
      try {
        const folderPrefix = String(p.image_path).replace(/\/$/, "");
        const key = await discoverFileByExtensions(folderPrefix, [".jpg", ".jpeg", ".png", ".webp"]);
        return { ...p, cover_art_r2_key: key || null };
      } catch {
        return { ...p, cover_art_r2_key: null };
      }
    })
  );

  // Normalize catalog products into the unified release shape
  const catalogAsReleases = catalogWithArt.map((p) => {
    const releaseType = p.release_type || p.product_type || "single";
    const isMultiTrack = ["album", "mixtape", "ep", "albums", "mixtapes-and-eps"].includes(releaseType);
    const trackCounts = catalogTrackCountByProduct[p.id] || { total: 0, ready: 0 };

    // Singles/features that aren't multi-track are always 1 track
    if (!isMultiTrack && trackCounts.total === 0) {
      trackCounts.total = 1;
      trackCounts.ready = 1;
    }

    return {
      id: p.id,
      slug: p.slug,
      status: p.active ? "published" : "draft",
      release_type: releaseType,
      release_date: p.metadata?.release_date || null,
      storefront_visible: Boolean(p.active),
      scheduled_at: null,
      cover_art_r2_key: p.cover_art_r2_key,
      upc: p.metadata?.upc || null,
      created_at: p.created_at || p.updated_at,
      title: p.title,
      product_active: Boolean(p.active),
      track_counts: trackCounts,
      price_cents: p.price_cents || null,
      source: "catalog",
    };
  });

  // ── 3. Merge: wizard releases win on slug conflict ─────────────────────────
  // Catalog entries go in first, then wizard entries overwrite matching slugs
  const merged = new Map();
  for (const r of catalogAsReleases) {
    merged.set(r.slug, r);
  }
  for (const r of enrichedWizard) {
    merged.set(r.slug, r);
  }

  // Sort newest first
  const allReleases = [...merged.values()].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );

  return NextResponse.json({ releases: allReleases });
}
