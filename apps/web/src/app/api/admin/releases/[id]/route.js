import { loadEditableRelease, commitCreditEdit } from "@/lib/credits/admin-store";
import { NextResponse } from "next/server";
import { getAdminSessionUser, requireAdminActor } from "@/lib/auth/admin-api-guard";
import { classifyAdminAuthorityDenial } from "@/lib/auth/admin-authority-diagnostics";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { discoverFileByExtensions } from "@/lib/storage/r2";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";
import { validateLifecycleConfiguration } from "@/lib/releases/release-availability";

export const dynamic = "force-dynamic";

// ── GET /api/admin/releases/[id] ─────────────────────────────────────────────────
// Returns full release detail for the inline editor.
// Falls through: releases table first (wizard uploads), then products table (catalog).
export async function GET(req, { params }) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.detail",
    limit: 120,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Release ID required" }, { status: 400 });

  const admin = getAdminClient();

  try {
    const detail = await loadEditableRelease(admin, id);
    if (!detail) return NextResponse.json({ error: "Release not found" }, { status: 404 });
    if (!detail.release.cover_art_r2_key) {
      const { data: product } = await admin.from("products").select("image_path").eq(detail.source === "releases" ? "release_id" : "id", id).maybeSingle();
      if (product?.image_path) {
        try { detail.release.cover_art_r2_key = await discoverFileByExtensions(String(product.image_path).replace(/\/$/, ""), [".jpg", ".jpeg", ".png", ".webp"]); } catch {}
      }
    }
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load saved release metadata" }, { status: 503 });
  }
}

// ── PATCH /api/admin/releases/[id] ───────────────────────────────────────────────
// Body: { title?, price?, genre?, release_date?, track_lyrics? [{id, lyrics}] }
// Handles both wizard releases (releases table) and catalog products (products table).
export async function PATCH(req, { params }) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.patch",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Release ID required" }, { status: 400 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const { title, price, genre, release_date, track_lyrics } = body;
  const lifecycleKeys = [
    "available_at", "release_timezone", "upcoming_visible", "preview_before_release",
    "preorder_enabled", "preorder_starts_at", "preorder_price_cents",
    "early_access_enabled", "early_access_starts_at", "early_access_scope",
    "early_access_audiences", "unavailable_at",
  ];

  const admin = getAdminClient();
  if (["revision", "credit_groups", "recordings", "upc", "artist", "release_type"].some(key => Object.hasOwn(body, key))) {
    const outcome = await commitCreditEdit(admin, id, body);
    if (outcome.status === 200 && outcome.result?.status !== "draft") revalidateStorefront(outcome.result?.slug, outcome.result?.release_type);
    return NextResponse.json(outcome.body, { status: outcome.status });
  }
  const errors = [];

  if (body.action === "undo_dump") {
    const { error } = await admin.from("draft_deletion_jobs").delete().eq("release_id", id).is("finalized_at", null);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, restored: id });
  }
  if (body.action === "archive") {
    const { data: archivedRelease, error } = await admin
      .from("releases")
      .update({ status: "archived", storefront_visible: false, unavailable_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["scheduled", "published"])
      .select("slug, release_type")
      .maybeSingle();
    if (!error) await admin.from("products").update({ active: false }).eq("release_id", id);
    // Unpublishing must be as immediate as publishing — this call was missing,
    // so an archived release kept serving from the stale ISR cache for up to
    // an hour even though it was already correctly excluded from a fresh query.
    if (!error) revalidateStorefront(archivedRelease?.slug, archivedRelease?.release_type);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, archived: id });
  }

  // ── Path A: wizard release ─────────────────────────────────────────────────────
  const { data: release } = await admin
    .from("releases")
    .select("id, slug, status, release_type, scheduled_at, available_at, release_timezone, upcoming_visible, preview_before_release, preorder_enabled, preorder_starts_at, preorder_price_cents, early_access_enabled, early_access_starts_at, early_access_scope, early_access_audiences, unavailable_at")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (release) {
    const lifecycleUpdates = Object.fromEntries(
      lifecycleKeys.filter((key) => body[key] !== undefined).map((key) => [key, body[key]])
    );
    if (Object.keys(lifecycleUpdates).length) {
      const merged = { ...release, ...lifecycleUpdates };
      const availableMs = Date.parse(merged.available_at || merged.scheduled_at || "");
      if (Number.isFinite(availableMs)) {
        lifecycleUpdates.scheduled_at = merged.available_at;
        lifecycleUpdates.status = availableMs <= Date.now() ? "published" : "scheduled";
        lifecycleUpdates.storefront_visible = lifecycleUpdates.status === "published" || Boolean(merged.upcoming_visible);
      }
      const validationErrors = validateLifecycleConfiguration({ ...merged, ...lifecycleUpdates });
      if (validationErrors.length) return NextResponse.json({ error: validationErrors.join("; ") }, { status: 422 });
      const { error } = await admin.from("releases").update(lifecycleUpdates).eq("id", id);
      if (error) errors.push(`releases.lifecycle: ${error.message}`);
      await admin.from("products").update({ active: lifecycleUpdates.status === "published" || Boolean(merged.upcoming_visible) }).eq("release_id", id);
    }
    if (release_date !== undefined) {
      const { error } = await admin.from("releases").update({ release_date }).eq("id", id);
      if (error) errors.push(`releases.release_date: ${error.message}`);
    }

    if (title !== undefined || price !== undefined || genre !== undefined) {
      const { data: currentProduct } = await admin
        .from("products")
        .select("metadata, price_cents")
        .eq("release_id", id)
        .maybeSingle();

      const updates = {};
      if (title !== undefined) { updates.title = title; updates.display_title = title; }
      if (price !== undefined && price !== "") {
        const priceCents = Math.round(parseFloat(price) * 100);
        if (!isNaN(priceCents) && priceCents >= 0) updates.price_cents = priceCents;
      }
      if (genre !== undefined) {
        updates.metadata = { ...(currentProduct?.metadata || {}), genre };
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await admin.from("products").update(updates).eq("release_id", id);
        if (error) errors.push(`products: ${error.message}`);
      }
    }

    if (Array.isArray(track_lyrics) && track_lyrics.length > 0) {
      for (const { id: trackId, lyrics } of track_lyrics) {
        if (!trackId) continue;
        const { error } = await admin
          .from("tracks")
          .update({ lyrics: lyrics || "" })
          .eq("id", trackId)
          .eq("release_id", id);
        if (error) errors.push(`track ${trackId}: ${error.message}`);
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ ok: false, errors }, { status: 207 });
    }

    // A draft mutation must never bust the storefront ISR cache — only revalidate
    // once this release is actually (or about to become) publicly visible. Use the
    // post-update status, not the pre-fetch one, since this same lifecycle branch
    // can be what flips a release from draft to scheduled/published.
    const finalStatus = lifecycleUpdates.status || release.status;
    if (finalStatus !== "draft") {
      revalidateStorefront(release.slug, release.release_type);
    }
    return NextResponse.json({ ok: true });
  }

  // ── Path B: catalog product ────────────────────────────────────────────────────
  const { data: product, error: productErr } = await admin
    .from("products")
    .select("id, metadata, price_cents")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (productErr || !product) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  const productUpdates = {};
  if (title !== undefined) { productUpdates.title = title; productUpdates.display_title = title; }
  if (price !== undefined && price !== "") {
    const priceCents = Math.round(parseFloat(price) * 100);
    if (!isNaN(priceCents) && priceCents >= 0) productUpdates.price_cents = priceCents;
  }

  const currentMeta = product.metadata || {};
  const metaUpdates = {};
  if (genre !== undefined) metaUpdates.genre = genre;
  if (release_date !== undefined) metaUpdates.release_date = release_date;

  if (Object.keys(metaUpdates).length > 0) {
    productUpdates.metadata = { ...currentMeta, ...metaUpdates };
  }

  if (Object.keys(productUpdates).length > 0) {
    const { error } = await admin.from("products").update(productUpdates).eq("id", id);
    if (error) errors.push(`products: ${error.message}`);
  }

  // Lyrics for catalog tracks — stored in catalog_tracks.metadata.lyrics
  if (Array.isArray(track_lyrics) && track_lyrics.length > 0) {
    for (const { id: trackId, lyrics } of track_lyrics) {
      if (!trackId) continue;
      const { data: ct } = await admin
        .from("catalog_tracks")
        .select("metadata")
        .eq("id", trackId)
        .eq("product_id", id)
        .maybeSingle();
      if (ct) {
        const { error } = await admin
          .from("catalog_tracks")
          .update({ metadata: { ...(ct.metadata || {}), lyrics: lyrics || "" } })
          .eq("id", trackId)
          .eq("product_id", id);
        if (error) errors.push(`catalog_track ${trackId}: ${error.message}`);
      }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 207 });
  }

  revalidateStorefront();
  return NextResponse.json({ ok: true });
}

// One transaction owns logical deletion for drafts, published and legacy releases.
export async function DELETE(req, { params }) {
  const gate = await requireAdminActor({ recentSeconds: 15 * 60 });
  if (!gate.ok) {
    const denial = classifyAdminAuthorityDenial(gate.reason);
    return NextResponse.json({ error: denial.status === 401 ? "Unauthorized" : "Forbidden", code: denial.code },
      { status: denial.status, headers: { "Cache-Control": "private, no-store" } });
  }
  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.delete", limit: 20, windowSeconds: 60, identifier: gate.user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "")) {
    return NextResponse.json({ error: "Valid release ID required" }, { status: 400 });
  }
  const source = new URL(req.url).searchParams.get("source") || "auto";
  if (!["auto", "releases", "catalog"].includes(source)) return NextResponse.json({ error: "Invalid release source" }, { status: 400 });
  try {
    const { data, error } = await getAdminClient().rpc("delete_release", { p_id: id, p_actor_id: gate.user.id, p_source: source });
    if (error) {
      console.error("[admin/releases] deletion transaction failed", { id, code: error.code });
      return NextResponse.json({ error: "Release deletion failed. Refresh and try again.", code: "RELEASE_DELETE_FAILED" },
        { status: error.code === "42501" ? 403 : 503 });
    }
    if (!data?.ok) return NextResponse.json({ error: data?.code === "unsupported_release" ? "Unsupported release type" : "Release not found" },
      { status: data?.code === "unsupported_release" ? 422 : 404 });
    revalidateStorefront(data.slug, data.release_type);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[admin/releases] deletion request failed", { id, message: error?.message });
    return NextResponse.json({ error: "Release deletion could not be confirmed. Refresh before retrying." }, { status: 503 });
  }
}
