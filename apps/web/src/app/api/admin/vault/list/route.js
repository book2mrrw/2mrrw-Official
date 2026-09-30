import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { listR2Objects, deleteR2Object } from "@/lib/storage/r2";
import {
  folderForCategory,
  VISIBILITIES,
  ACCESS_TIERS,
} from "@/lib/vault/vault-upload-contract";
import {
  buildVaultAudioHlsPrefix,
  VAULT_AUDIO_RELEASE_TYPE,
} from "@/lib/vault/vault-audio-contract";

export const dynamic = "force-dynamic";

/**
 * Everything in a section, drafts included -- this is the admin's view, not
 * the public one, so it deliberately ignores entitlement filtering.
 *
 * Ordered by sort_order to match what the chamber actually shows
 * (loadPublishedVaultContent orders the same way). A manage screen that
 * listed items in a different order from the room would make reordering
 * impossible to reason about.
 */
export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const category = new URL(req.url).searchParams.get("category");
  const admin = getAdminClient();
  let query = admin
    .from("vault_content")
    .select("id, slug, category, title, description, media_type, access_tier, visibility, media_storage_path, duration_seconds, sort_order, updated_at")
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(200);

  if (category) {
    if (!folderForCategory(category)) {
      return NextResponse.json({ error: "Unknown vault section" }, { status: 400 });
    }
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) {
    console.error("vault list failed:", error);
    return NextResponse.json({ error: "Could not load vault entries" }, { status: 500 });
  }
  return NextResponse.json({ items: data || [] });
}

/**
 * Edit one entry: visibility, the written metadata, its tier, or its place in
 * the order. Every field is optional and only what is sent gets written, so
 * the publish toggle and the edit form can share one endpoint without either
 * clobbering fields the other never showed.
 *
 * Deliberately cannot change `slug` or `category`: both are baked into the
 * object key in storage, so changing either here would leave the row pointing
 * at a file that is no longer where it says it is. Re-uploading is the honest
 * way to move something.
 */
export async function PATCH(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.update",
    limit: 60,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, visibility, title, description, accessTier, sortOrder } = body || {};
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const patch = { updated_at: new Date().toISOString() };

  if (visibility !== undefined) {
    if (!VISIBILITIES.includes(visibility)) {
      return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
    }
    patch.visibility = visibility;
    // Stamped the first time it goes live so the public feed has something
    // honest to sort on.
    if (visibility === "published") patch.published_at = new Date().toISOString();
  }

  if (title !== undefined) {
    const trimmed = String(title).trim();
    if (!trimmed) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    if (trimmed.length > 200) {
      return NextResponse.json({ error: "Title is too long (max 200)" }, { status: 400 });
    }
    patch.title = trimmed;
  }

  if (description !== undefined) {
    const text = String(description);
    if (text.length > 5000) {
      return NextResponse.json({ error: "Description is too long (max 5000)" }, { status: 400 });
    }
    patch.description = text;
  }

  if (accessTier !== undefined) {
    if (!ACCESS_TIERS.includes(accessTier)) {
      return NextResponse.json({ error: "Invalid accessTier" }, { status: 400 });
    }
    patch.access_tier = accessTier;
  }

  if (sortOrder !== undefined) {
    const n = Number(sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 100000) {
      return NextResponse.json({ error: "Invalid sortOrder" }, { status: 400 });
    }
    patch.sort_order = n;
  }

  // Only updated_at would change: nothing was actually asked for.
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("vault_content")
    .update(patch)
    .eq("id", id)
    .select("id, slug, title, description, access_tier, visibility, sort_order, published_at")
    .maybeSingle();

  if (error) {
    console.error("vault update failed:", error);
    return NextResponse.json({ error: "Could not update the entry" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  return NextResponse.json({ ok: true, item: data });
}

/**
 * Removes an entry and everything it owns in storage.
 *
 * The row goes first. An orphaned object is billable but harmless, whereas a
 * row pointing at deleted media renders a broken item in the chamber -- the
 * same ordering the section-cover delete uses.
 *
 * Storage cleanup is then best-effort and never fails the request: once the
 * row is gone the item is gone as far as anyone browsing is concerned, and
 * reporting failure would invite a retry that has nothing left to delete.
 */
export async function DELETE(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.delete",
    limit: 20,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = getAdminClient();

  const { data: item, error: loadErr } = await admin
    .from("vault_content")
    .select("id, slug, category, media_type, media_storage_path")
    .eq("id", id)
    .maybeSingle();

  if (loadErr) {
    console.error("vault delete lookup failed:", loadErr);
    return NextResponse.json({ error: "Could not load the entry" }, { status: 500 });
  }
  if (!item) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  const { error: delErr } = await admin.from("vault_content").delete().eq("id", id);
  if (delErr) {
    console.error("vault delete failed:", delErr);
    return NextResponse.json({ error: "Could not delete the entry" }, { status: 500 });
  }

  const removed = { object: false, segments: 0, job: false, manifest: false };

  // The uploaded file or audio master.
  if (item.media_storage_path) {
    try {
      await deleteR2Object(item.media_storage_path);
      removed.object = true;
    } catch (err) {
      console.error("vault delete object failed:", item.media_storage_path, err?.message);
    }
  }

  // The encrypted ladder, if this item was ever transcoded. Guarded on the
  // prefix the contract builds rather than anything from the row, so a
  // malformed category can never turn this into a delete somewhere else.
  const hlsPrefix = buildVaultAudioHlsPrefix({ category: item.category, slug: item.slug });
  if (hlsPrefix && hlsPrefix.startsWith("hls/vault/")) {
    try {
      const objects = await listR2Objects(hlsPrefix, { recursive: true });
      for (const obj of objects) {
        if (!obj?.Key?.startsWith(hlsPrefix)) continue;
        await deleteR2Object(obj.Key).catch(() => {});
        removed.segments += 1;
      }
    } catch (err) {
      console.error("vault delete segments failed:", hlsPrefix, err?.message);
    }
  }

  // The queue and manifest rows, pinned to this pipeline's own release_type.
  // A release that happened to share this slug must never be touched here.
  try {
    const { error: jobErr } = await admin
      .from("hls_transcode_jobs")
      .delete()
      .eq("slug", item.slug)
      .is("track_slug", null)
      .eq("release_type", VAULT_AUDIO_RELEASE_TYPE);
    removed.job = !jobErr;

    const { error: manErr } = await admin
      .from("hls_manifests")
      .delete()
      .eq("slug", item.slug)
      .is("track_slug", null)
      .eq("release_type", VAULT_AUDIO_RELEASE_TYPE);
    removed.manifest = !manErr;
  } catch (err) {
    console.error("vault delete transcode rows failed:", item.slug, err?.message);
  }

  return NextResponse.json({ ok: true, removed });
}
