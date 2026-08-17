/**
 * POST /api/admin/hls/complete
 *
 * Called by the Fly.io HLS transcoder worker immediately after it has written
 * the hls_manifests row to Supabase. The sole job of this endpoint is to
 * invalidate the L1+L2 manifest cache so the NEXT /api/library/hls request
 * for this slug hits the DB and serves the real manifest, rather than waiting
 * up to 24 h for the TTL to expire (which would leave clients stuck on
 * progressive download despite a completed transcode).
 *
 * Auth: Bearer token — the worker must send the same value that is stored in
 * the HLS_WORKER_API_TOKEN environment variable on both sides. This is
 * service-to-service auth, never exposed to browser clients.
 *
 * Body: { slug: string, trackSlug?: string | null }
 *
 * Response 200: { ok: true, slug, trackSlug }
 * Response 401: missing or wrong token
 * Response 400: missing slug
 * Response 500: cache invalidation failed (rare — TTL will self-heal)
 */

import { NextResponse } from "next/server";
import { invalidateManifestCache } from "@/lib/server/hls-manifest-cache";

const LOG_PREFIX = "[hls/complete]";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function verifyWorkerToken(req) {
  const token = process.env.HLS_WORKER_API_TOKEN;
  if (!token) {
    // If the env var is not set, block all requests — do not open an unauthenticated
    // cache-invalidation endpoint. Log so operators notice the misconfiguration.
    console.error(`${LOG_PREFIX} HLS_WORKER_API_TOKEN is not set — endpoint is locked`);
    return false;
  }
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer === token;
}

export async function POST(req) {
  if (!verifyWorkerToken(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const slug = String(body.slug || "").trim();
  if (!slug) {
    return json({ error: "slug required" }, 400);
  }

  const trackSlug = body.trackSlug ? String(body.trackSlug).trim() : null;

  try {
    await invalidateManifestCache(slug, trackSlug);
    console.log(`${LOG_PREFIX} manifest cache invalidated`, { slug, trackSlug });
    return json({ ok: true, slug, trackSlug });
  } catch (err) {
    // Cache invalidation failure is logged but not fatal — the DB row already exists
    // and the TTL will self-heal within 24 h. A 500 here causes the worker to retry,
    // which is safe (invalidateManifestCache is idempotent).
    console.error(`${LOG_PREFIX} cache invalidation failed`, { slug, trackSlug, error: err?.message });
    return json({ error: "Cache invalidation failed", slug, trackSlug }, 500);
  }
}
