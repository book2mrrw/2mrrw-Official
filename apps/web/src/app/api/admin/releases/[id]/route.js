import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { discoverFileByExtensions } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

// ── GET /api/admin/releases/[id] ─────────────────────────────────────────────────
// Returns full release detail for the inline editor.
// Falls through: releases table first (wizard uploads), then products table (catalog).
export async function GET(req, { params }) {
  const user = await getFanSessionUser();
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

  const { id } = params;
  if (!id) return NextResponse.json({ error: "Release ID required" }, { status: 400 });

  const admin = getAdminClient();

  // ── Path A: wizard release (releases table) ───────────────────────────────────
  const [releaseRes, productRes, tracksRes] = await Promise.all([
    admin
      .from("releases")
      .select("id, slug, status, release_type, release_date, scheduled_at, storefront_visible, cover_art_r2_key, upc, created_at")
      .eq("id", id)
      .single(),
    admin
      .from("products")
      .select("title, display_title, price_cents, metadata")
      .eq("release_id", id)
      .maybeSingle(),
    admin
      .from("tracks")
      .select("id, slug, title, position, lyrics, upload_status, audio_r2_key")
      .eq("release_id", id)
      .order("position", { ascending: true }),
  ]);

  if (!releaseRes.error && releaseRes.data) {
    const release = releaseRes.data;
    const product = productRes.data;
    const tracks  = tracksRes.data || [];
    return NextResponse.json({
      source: "releases",
      release: {
        id:                release.id,
        slug:              release.slug,
        status:            release.status,
        release_type:      release.release_type,
        release_date:      release.release_date,
        scheduled_at:      release.scheduled_at,
        storefront_visible: release.storefront_visible,
        cover_art_r2_key:  release.cover_art_r2_key,
      },
      product: {
        title:         product?.title         || null,
        display_title: product?.display_title || null,
        price_cents:   product?.price_cents   || null,
        genre:         product?.metadata?.genre || null,
      },
      tracks: tracks.map((t) => ({
        id:            t.id,
        slug:          t.slug,
        title:         t.title || "",
        position:      t.position,
        lyrics:        t.lyrics || "",
        upload_status: t.upload_status,
        has_audio:     Boolean(t.audio_r2_key),
      })),
    });
  }

  // ── Path B: catalog product (products table, R2-ingested) ─────────────────────
  const { data: product, error: productErr } = await admin
    .from("products")
    .select("id, slug, title, product_type, release_type, active, image_path, price_cents, created_at, updated_at, metadata")
    .eq("id", id)
    .single();

  if (productErr || !product) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  // Catalog tracks
  const { data: catalogTracks } = await admin
    .from("catalog_tracks")
    .select("id, slug, title, position, metadata")
    .eq("product_id", id)
    .order("position", { ascending: true });

  // Discover cover art key from image_path folder
  let coverKey = null;
  if (product.image_path) {
    try {
      const folder = String(product.image_path).replace(/\/$/, "");
      coverKey = await discoverFileByExtensions(folder, [".jpg", ".jpeg", ".png", ".webp"]);
    } catch {}
  }

  const releaseType = product.release_type || product.product_type || "single";

  return NextResponse.json({
    source: "catalog",
    release: {
      id:                product.id,
      slug:              product.slug,
      status:            product.active ? "published" : "draft",
      release_type:      releaseType,
      release_date:      product.metadata?.release_date || null,
      scheduled_at:      null,
      storefront_visible: Boolean(product.active),
      cover_art_r2_key:  coverKey,
    },
    product: {
      title:         product.title || null,
      display_title: product.title || null,
      price_cents:   product.price_cents || null,
      genre:         product.metadata?.genre || null,
    },
    tracks: (catalogTracks || []).map((t, i) => ({
      id:            t.id,
      slug:          t.slug,
      title:         t.title || t.slug || "",
      position:      t.position ?? (i + 1),
      lyrics:        t.metadata?.lyrics || "",
      upload_status: "ready",
      has_audio:     true,
    })),
  });
}

// ── PATCH /api/admin/releases/[id] ───────────────────────────────────────────────
// Body: { title?, price?, genre?, release_date?, track_lyrics? [{id, lyrics}] }
// Handles both wizard releases (releases table) and catalog products (products table).
export async function PATCH(req, { params }) {
  const user = await getFanSessionUser();
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

  const { id } = params;
  if (!id) return NextResponse.json({ error: "Release ID required" }, { status: 400 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const { title, price, genre, release_date, track_lyrics } = body;

  const admin = getAdminClient();
  const errors = [];

  // ── Path A: wizard release ─────────────────────────────────────────────────────
  const { data: release } = await admin
    .from("releases")
    .select("id, slug, release_type")
    .eq("id", id)
    .single();

  if (release) {
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
        if (!isNaN(priceCents) && priceCents > 0) updates.price_cents = priceCents;
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

    try {
      revalidatePath("/");
      revalidatePath("/song/[slug]", "page");
      revalidatePath("/feature/[slug]", "page");
      revalidatePath("/album/[slug]", "page");
    } catch {}
    return NextResponse.json({ ok: true });
  }

  // ── Path B: catalog product ────────────────────────────────────────────────────
  const { data: product, error: productErr } = await admin
    .from("products")
    .select("id, metadata, price_cents")
    .eq("id", id)
    .single();

  if (productErr || !product) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  const productUpdates = {};
  if (title !== undefined) { productUpdates.title = title; productUpdates.display_title = title; }
  if (price !== undefined && price !== "") {
    const priceCents = Math.round(parseFloat(price) * 100);
    if (!isNaN(priceCents) && priceCents > 0) productUpdates.price_cents = priceCents;
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

  try {
    revalidatePath("/");
    revalidatePath("/song/[slug]", "page");
    revalidatePath("/feature/[slug]", "page");
    revalidatePath("/album/[slug]", "page");
  } catch {}
  return NextResponse.json({ ok: true });
}

// ── DELETE /api/admin/releases/[id] ─────────────────────────────────────────────
// Wizard drafts: hard-deletes releases + tracks rows (product row deactivated if exists).
// Catalog products (source=catalog): sets active=false (takedown, preserves purchase history).
// Query param: ?source=catalog to force catalog path when id is a product id.
export async function DELETE(req, { params }) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.delete",
    limit: 20,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id } = params;
  if (!id) return NextResponse.json({ error: "Release ID required" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const forceCatalog = searchParams.get("source") === "catalog";

  const admin = getAdminClient();

  if (!forceCatalog) {
    // ── Path A: wizard release ─────────────────────────────────────────────────
    const { data: release } = await admin
      .from("releases").select("id, slug, status").eq("id", id).maybeSingle();

    if (release) {
      // Deactivate any linked product (don't hard-delete — may have purchase history)
      await admin.from("products")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("release_id", id);

      // Also deactivate by slug in case it was ingested without release_id link
      if (release.slug) {
        await admin.from("products")
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq("slug", release.slug)
          .is("release_id", null);
      }

      // Hard-delete tracks
      await admin.from("tracks").delete().eq("release_id", id);

      // Hard-delete the release row
      const { error } = await admin.from("releases").delete().eq("id", id);
      if (error) {
        return NextResponse.json({ error: `Failed to delete release: ${error.message}` }, { status: 500 });
      }

      try {
        revalidatePath("/");
        revalidatePath("/song/[slug]", "page");
      } catch {}
      return NextResponse.json({ ok: true, deleted: "wizard_release" });
    }
  }

  // ── Path B: catalog product — takedown (set active=false) ─────────────────────
  const { data: product, error: productErr } = await admin
    .from("products").select("id, slug").eq("id", id).maybeSingle();

  if (productErr || !product) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  const { error: takedownErr } = await admin
    .from("products")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (takedownErr) {
    return NextResponse.json({ error: `Takedown failed: ${takedownErr.message}` }, { status: 500 });
  }

  try {
    revalidatePath("/");
    revalidatePath("/song/[slug]", "page");
    revalidatePath("/feature/[slug]", "page");
    revalidatePath("/album/[slug]", "page");
  } catch {}
  return NextResponse.json({ ok: true, deleted: "catalog_takedown" });
}
