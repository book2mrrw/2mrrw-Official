import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey, deleteR2Object } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { validateItemCover } from "@/lib/vault/vault-upload-contract";

export const dynamic = "force-dynamic";

/** Records card art against an item once its bytes are in storage. */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.item-cover.complete",
    limit: 40,
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

  const { id, category, slug, filename, size } = body || {};
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const checked = validateItemCover({ category, slug, filename, size });
  if (checked.error) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  // Only record what is provably in storage.
  let head;
  try {
    head = await headR2ObjectKey(checked.key);
  } catch (err) {
    console.error("vault item cover head failed:", err);
    return NextResponse.json({ error: "Could not verify upload" }, { status: 500 });
  }
  if (!head || !head.ContentLength) {
    return NextResponse.json({ error: "Upload not found in storage" }, { status: 409 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("vault_content")
    .update({ cover_url: checked.key, updated_at: new Date().toISOString() })
    .eq("id", id)
    // The key is built from category+slug, so a mismatched id would attach art
    // to the wrong row under the right name.
    .eq("slug", slug)
    .select("id, slug, cover_url")
    .maybeSingle();

  if (error) {
    console.error("vault item cover save failed:", error);
    return NextResponse.json({ error: "Could not save the cover" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  return NextResponse.json({ ok: true, item: data });
}

/** Clears an item's card art and removes the object with it. */
export async function DELETE(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = getAdminClient();
  const { data: existing } = await admin
    .from("vault_content")
    .select("id, cover_url")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  const { error } = await admin
    .from("vault_content")
    .update({ cover_url: null, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("vault item cover clear failed:", error);
    return NextResponse.json({ error: "Could not clear the cover" }, { status: 500 });
  }

  // Row first, object second: an orphaned object is billable but harmless,
  // whereas a row pointing at a deleted object renders a broken card. Only
  // ever our own prefix -- an external cover URL is not ours to delete.
  if (existing.cover_url?.startsWith("videos/vault/_item-covers/")) {
    await deleteR2Object(existing.cover_url).catch((err) =>
      console.error("vault item cover object delete failed:", err)
    );
  }

  return NextResponse.json({ ok: true });
}
