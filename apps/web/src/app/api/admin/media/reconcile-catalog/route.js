/**
 * GET /api/admin/media/reconcile-catalog[?slug=<slug>]
 *
 * Admin-only diagnostic: HEAD-checks every canonical catalog item's expected
 * R2 keys and reports which objects are confirmed present, which are missing,
 * and which would have fallen through to ListObjectsV2 discovery.
 *
 * Bucket discovery (ListObjectsV2) is NEVER triggered by user hot paths after
 * Batch 2 Final Closeout — this endpoint verifies that invariant holds.
 *
 * Usage:
 *   GET /api/admin/media/reconcile-catalog            — all items
 *   GET /api/admin/media/reconcile-catalog?slug=w2d   — one item
 *
 * Each result row contains:
 *   { slug, releaseType, videoKey, videoExists, imageKey, imageExists, source }
 *
 * "source" reflects which fast-path branch would serve this item on a user request:
 *   "canonical_video"  — serves derived video key (zero ListObjects)
 *   "canonical_image"  — serves derived image key (zero ListObjects)
 *   "discovery"        — NO concrete key available → ListObjectsV2 would fire (should be empty)
 */

import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import {
  CANONICAL_SINGLES,
  CANONICAL_FEATURES,
  CANONICAL_MIXTAPES_AND_EPS,
  getCanonicalReleaseBySlug,
} from "@/lib/media/canonical-catalog";
import { headR2ObjectKey } from "@/lib/storage/r2";
import { normalizeReleaseType } from "@/lib/media/normalize-release-type";
import { resolveConcreteVideoR2Key } from "@/lib/media/resolve-concrete-video-key";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

/** Mirror the fast-path key derivation from entity-resolver.js — no ListObjectsV2. */
function deriveKeysForRelease(raw) {
  const canonical = getCanonicalReleaseBySlug(raw.slug);
  if (!canonical) return { slug: raw.slug, source: "not_in_catalog" };

  const rType = normalizeReleaseType(canonical.release_type || "single") || "singles";

  // Video key: prefer legacy_video_stem, then explicit video field
  const legacyVideoKey = canonical.legacy_video_stem
    ? `videos/${rType}/${canonical.slug}/${canonical.legacy_video_stem}.mp4`
    : canonical.video
      ? String(canonical.video).replace(/^\//, "")
      : null;

  const videoKey = legacyVideoKey
    ? resolveConcreteVideoR2Key({ videoPath: legacyVideoKey, slug: canonical.slug })
    : null;

  // Image key: only when legacy_cover_stem is set
  const imageKey = canonical.legacy_cover_stem
    ? `images/${rType}/${canonical.slug}/${canonical.legacy_cover_stem}.jpeg`
    : null;

  const source = videoKey
    ? "canonical_video"
    : imageKey
      ? "canonical_image"
      : "discovery";  // would trigger ListObjectsV2 — must be empty post-closeout

  return { slug: canonical.slug, releaseType: rType, videoKey, imageKey, source };
}

export async function GET(req) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) return json({ error: "Forbidden" }, 403);

  const targetSlug = req.nextUrl.searchParams.get("slug") || null;

  const allRaw = [
    ...CANONICAL_SINGLES,
    ...CANONICAL_FEATURES,
    ...CANONICAL_MIXTAPES_AND_EPS,
  ].filter((r) => !targetSlug || r.slug === targetSlug);

  if (targetSlug && allRaw.length === 0) {
    return json({ error: "Slug not found in canonical catalog" }, 404);
  }

  const derived = allRaw.map(deriveKeysForRelease);

  // HEAD-check all keys concurrently — R2 HeadObject costs ~$0.004/million,
  // negligible for admin use. Never triggers ListObjectsV2.
  const results = await Promise.all(
    derived.map(async (item) => {
      if (item.source === "not_in_catalog") return { ...item, videoExists: false, imageExists: false };

      const [videoExists, imageExists] = await Promise.all([
        item.videoKey ? headR2ObjectKey(item.videoKey).then(Boolean).catch(() => false) : Promise.resolve(null),
        item.imageKey ? headR2ObjectKey(item.imageKey).then(Boolean).catch(() => false) : Promise.resolve(null),
      ]);

      return { ...item, videoExists, imageExists };
    })
  );

  const discoveryItems = results.filter((r) => r.source === "discovery");
  const missingVideo   = results.filter((r) => r.videoKey && r.videoExists === false);
  const missingImage   = results.filter((r) => r.imageKey && r.imageExists === false && !r.videoKey);

  return json({
    checked:          results.length,
    listObjectsFree:  discoveryItems.length === 0,  // true = GAP 1 closed
    discoveryItems:   discoveryItems.map((r) => r.slug),
    missingVideoKeys: missingVideo.map((r) => ({ slug: r.slug, key: r.videoKey })),
    missingImageKeys: missingImage.map((r) => ({ slug: r.slug, key: r.imageKey })),
    items:            results,
  });
}
