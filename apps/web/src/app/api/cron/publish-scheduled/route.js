import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const auth     = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getAdminClient();
  const now   = new Date().toISOString();

  // Find all scheduled releases whose time has arrived
  const { data: dueReleases, error: fetchErr } = await admin
    .from("releases")
    .select("id, slug, release_type")
    .eq("status", "scheduled")
    .lte("available_at", now)
    .not("available_at", "is", null);

  if (fetchErr) {
    console.error("[cron/publish-scheduled] fetch error", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!dueReleases?.length) {
    return NextResponse.json({ published: 0, message: "No scheduled releases due" });
  }

  const results = [];

  for (const rel of dueReleases) {
    try {
      // Update release to published + visible
      const { error: relErr } = await admin
        .from("releases")
        .update({ status: "published", storefront_visible: true, published_at: now })
        .eq("id", rel.id);
      if (relErr) throw relErr;

      // Activate products row
      const { error: productErr } = await admin
        .from("products")
        .update({ active: true })
        .eq("release_id", rel.id);
      if (productErr) {
        console.warn("[cron/publish-scheduled] products update error (non-fatal)", productErr.message);
      }

      results.push({ id: rel.id, slug: rel.slug, ok: true });
      console.info(`[cron/publish-scheduled] published id=${rel.id} slug=${rel.slug}`);
    } catch (err) {
      results.push({ id: rel.id, slug: rel.slug, ok: false, error: err.message });
      console.error(`[cron/publish-scheduled] failed id=${rel.id}`, err.message);
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  if (succeeded > 0) revalidateStorefront();
  return NextResponse.json({ published: succeeded, total: dueReleases.length, results });
}
