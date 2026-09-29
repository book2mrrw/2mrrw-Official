import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey, deleteR2Object } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import {
  folderForCategory,
  validateSectionCover,
  SECTION_COVER_KINDS,
} from "@/lib/vault/vault-upload-contract";

export const dynamic = "force-dynamic";

/** Every section's cover, for the manager's overview. */
export async function GET() {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("vault_section_covers")
    .select("category, motion_key, still_key, updated_at");

  if (error) {
    console.error("vault section cover list failed:", error);
    return NextResponse.json({ error: "Could not load section covers" }, { status: 500 });
  }
  return NextResponse.json({ covers: data || [] });
}

/**
 * Records a cover once its bytes are in storage.
 *
 * A motion cover is stored alongside a still rather than on its own: the
 * still is the poster, the fallback when the video cannot decode, and what
 * shows before it does. CoverArt treats a cover as that pair throughout, and
 * a lone video would leave a pod blank exactly when it matters.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.section-cover.complete",
    limit: 30,
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

  const { category, filename, size, durationSeconds = null } = body || {};
  const checked = validateSectionCover({ category, filename, size });
  if (checked.error) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  if (checked.kind === "motion") {
    const max = SECTION_COVER_KINDS.motion.maxDurationSeconds;
    if (Number.isFinite(durationSeconds) && durationSeconds > max + 0.5) {
      return NextResponse.json(
        { error: `A section cover loop must be ${max} seconds or shorter` },
        { status: 400 }
      );
    }
  }

  // Only record what is provably in storage.
  let head;
  try {
    head = await headR2ObjectKey(checked.key);
  } catch (err) {
    console.error("vault section cover head failed:", err);
    return NextResponse.json({ error: "Could not verify upload" }, { status: 500 });
  }
  if (!head || !head.ContentLength) {
    return NextResponse.json({ error: "Upload not found in storage" }, { status: 409 });
  }

  const column = checked.kind === "motion" ? "motion_key" : "still_key";
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("vault_section_covers")
    .upsert(
      {
        category,
        [column]: checked.key,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "category" }
    )
    .select("category, motion_key, still_key, updated_at")
    .maybeSingle();

  if (error) {
    console.error("vault section cover upsert failed:", error);
    return NextResponse.json({ error: "Could not save the cover" }, { status: 500 });
  }

  const needsStill = Boolean(data?.motion_key) && !data?.still_key;
  return NextResponse.json({ ok: true, cover: data, kind: checked.kind, needsStill });
}

/** Clears one kind of cover for a section, removing the object with it so a
 *  cleared cover does not leave paid-for bytes behind. */
export async function DELETE(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const kind = url.searchParams.get("kind");

  if (!folderForCategory(category)) {
    return NextResponse.json({ error: "Unknown vault section" }, { status: 400 });
  }
  if (kind !== "motion" && kind !== "still") {
    return NextResponse.json({ error: "kind must be motion or still" }, { status: 400 });
  }

  const column = kind === "motion" ? "motion_key" : "still_key";
  const admin = getAdminClient();

  const { data: existing } = await admin
    .from("vault_section_covers")
    .select("motion_key, still_key")
    .eq("category", category)
    .maybeSingle();

  const { error } = await admin
    .from("vault_section_covers")
    .update({ [column]: null, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq("category", category);

  if (error) {
    console.error("vault section cover clear failed:", error);
    return NextResponse.json({ error: "Could not clear the cover" }, { status: 500 });
  }

  // Row first, object second: an orphaned object is billable but harmless,
  // whereas a row pointing at a deleted object renders a broken pod.
  if (existing?.[column]) {
    await deleteR2Object(existing[column]).catch((err) =>
      console.error("vault section cover object delete failed:", err)
    );
  }

  return NextResponse.json({ ok: true });
}
