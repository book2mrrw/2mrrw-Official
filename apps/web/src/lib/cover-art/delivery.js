/**
 * Cover art delivery: the silent looping renditions the cover-art lane makes
 * (apps/web/workers/cover-art, table cover_art_versions) in place of an
 * original cover video. /api/media/visual asks here before redirecting, so
 * every page and the app get them without any URL changing; a cover with no
 * ready version keeps serving its original.
 *
 * The same lookup keeps the lane fed: a cover video seen without a version
 * (or whose original changed) is queued after the response, so every viewed
 * cover — including future uploads — is processed without a list to maintain.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { getPublicR2Url, getR2ObjectMetadata } from "@/lib/storage/r2";

const VERSION_TTL_MS = 2 * 60 * 1000;
const SOURCE_CHECK_MS = 10 * 60 * 1000;
const VIDEO_KEY = /\.(mp4|m4v|mov|webm)$/i;

/** source key -> { row, readAt, sourceCheckedAt } (per server instance) */
const versions = new Map();

/**
 * The rendition to serve: `variant` "tall" (the 3:4 lock-screen shape), a
 * square size ("1080", "720", "480": the largest square at most that size),
 * or by default the largest square.
 */
export function pickRendition(renditions, variant = null) {
  if (!Array.isArray(renditions)) return null;
  if (variant === "tall") return renditions.find((r) => r.id === "tall") ?? null;
  const squares = renditions.filter((r) => String(r.id).startsWith("square-")).sort((a, b) => b.width - a.width);
  const size = Number(variant);
  if (variant && Number.isFinite(size) && size > 0) return squares.find((r) => r.width <= size) ?? squares.at(-1) ?? null;
  return squares[0] ?? null;
}

async function readVersion(db, sourceKey) {
  const { data, error } = await db
    .from("cover_art_versions")
    .select("id, source_etag, status, renditions")
    .eq("source_key", sourceKey)
    .neq("status", "superseded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Queue the original when it has no version yet or has been replaced since. */
async function queueIfChanged(db, sourceKey, row) {
  const meta = await getR2ObjectMetadata(sourceKey);
  const etag = String(meta?.etag || "").replace(/"/g, "");
  if (!etag || row?.source_etag === etag) return;
  const { error } = await db.rpc("queue_cover_art", { p_source_key: sourceKey, p_source_etag: etag });
  if (error) throw error;
  versions.delete(sourceKey);
}

/**
 * The public URL of a cover video's silent rendition, or null to serve the
 * original. `schedule(task)` runs the queue check after the response.
 */
export async function coverArtUrl(sourceKey, { variant = null, schedule = (task) => void task().catch(() => {}), db, now = Date.now() } = {}) {
  if (!sourceKey || !VIDEO_KEY.test(sourceKey)) return null;
  const client = db ?? getAdminClient();
  let entry = versions.get(sourceKey);
  if (!entry || now - entry.readAt > VERSION_TTL_MS) {
    entry = { row: await readVersion(client, sourceKey), readAt: now, sourceCheckedAt: entry?.sourceCheckedAt ?? 0 };
    versions.set(sourceKey, entry);
  }
  if (!entry.row || now - entry.sourceCheckedAt > SOURCE_CHECK_MS) {
    entry.sourceCheckedAt = now;
    const row = entry.row;
    schedule(() => queueIfChanged(client, sourceKey, row));
  }
  if (entry.row?.status !== "ready") return null;
  const rendition = pickRendition(entry.row.renditions, variant);
  return rendition?.key ? getPublicR2Url(rendition.key) : null;
}

/** Test-only: forget every cached version. */
export function resetCoverArtDelivery() {
  versions.clear();
}
