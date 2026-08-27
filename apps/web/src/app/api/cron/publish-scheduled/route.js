import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";
import { emitServerEvent } from "@/lib/observability/server-events";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const correlationId = req.headers.get("x-correlation-id") || crypto.randomUUID();
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
    emitServerEvent("error", "scheduled_release_discovery_failed", { correlationId }, fetchErr);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!dueReleases?.length) {
    return NextResponse.json({ published: 0, message: "No scheduled releases due" });
  }

  const results = [];

  for (const rel of dueReleases) {
    try {
      // Atomic, idempotent cross-table transition (releases.status +
      // products.active together) — see 20260827000052_atomic_scheduled_release_activation.sql.
      // Two independent .update() calls here previously let a products write
      // failure leave the release permanently split-brained (published in
      // one table, inactive in the other) with only a warning logged.
      const { data: activation, error: rpcErr } = await admin
        .rpc("activate_scheduled_release", { p_release_id: rel.id })
        .single();
      if (rpcErr) throw rpcErr;

      if (!activation?.activated) {
        // Already activated by a prior tick (or no longer due) — not a failure.
        results.push({ id: rel.id, slug: rel.slug, ok: true, skipped: true });
        continue;
      }

      results.push({ id: rel.id, slug: rel.slug, ok: true });
      emitServerEvent("info", "scheduled_release_published",
        { correlationId, releaseId: rel.id, releaseSlug: rel.slug, releaseType: rel.release_type });
    } catch (err) {
      results.push({ id: rel.id, slug: rel.slug, ok: false, error: err.message });
      emitServerEvent("error", "scheduled_release_publication_failed",
        { correlationId, releaseId: rel.id, releaseSlug: rel.slug, releaseType: rel.release_type }, err);
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  if (succeeded > 0) revalidateStorefront();
  emitServerEvent(succeeded === dueReleases.length ? "info" : "warn", "scheduled_release_batch_completed",
    { correlationId, due: dueReleases.length, published: succeeded, failed: dueReleases.length - succeeded });
  return NextResponse.json({ published: succeeded, total: dueReleases.length, results });
}
