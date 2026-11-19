/**
 * The cover-art lane's storage authority. The worker holds no storage
 * credential: for a job it currently holds (the id and lease token
 * claim_cover_art_job issued it), the website signs a short-lived link to
 * read that job's original and links to write that job's renditions under
 * cover-art/ — nothing else, and only while the lease is current.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { createR2SignedGetUrl, createR2SignedPutUrl } from "@/lib/storage/r2";

export const RENDITION_PREFIX = "cover-art/";
const RENDITION_ID = /^(square-\d{2,4}|tall)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_TTL_SECONDS = 15 * 60;
const MAX_RENDITIONS = 8;
export const RENDITION_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Where a rendition lives: under cover-art/, mirroring the original's folder
 * (videos/singles/w2d/w2d.mp4 -> cover-art/singles/w2d/<version>/square-720.mp4).
 */
export function renditionKey(sourceKey, sourceEtag, renditionId) {
  const folder = String(sourceKey).replace(/^videos\//, "").split("/").slice(0, -1).join("/");
  const version = String(sourceEtag || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "v";
  return `${RENDITION_PREFIX}${folder ? `${folder}/` : ""}${version}/${renditionId}.mp4`;
}

/**
 * Links for a held job: always the original's read link; upload links for the
 * listed rendition ids. Returns { status, body }.
 */
export async function laneTransfers({ id, leaseToken, renditions = [] }, { db } = {}) {
  if (!UUID.test(String(id)) || !UUID.test(String(leaseToken))) return { status: 400, body: { error: "id and lease_token are required" } };
  const ids = [...new Set(Array.isArray(renditions) ? renditions : [])];
  if (ids.length > MAX_RENDITIONS || ids.some((r) => !RENDITION_ID.test(String(r)))) {
    return { status: 400, body: { error: "unknown rendition" } };
  }
  const client = db ?? getAdminClient();
  const { data, error } = await client
    .from("cover_art_versions")
    .select("source_key, source_etag, status, lease_token")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "processing" || data.lease_token !== leaseToken) {
    return { status: 403, body: { error: "not the current holder of this job" } };
  }
  const source = await createR2SignedGetUrl(data.source_key, LINK_TTL_SECONDS);
  const uploads = await Promise.all(ids.map(async (renditionId) => {
    const key = renditionKey(data.source_key, data.source_etag, renditionId);
    const url = await createR2SignedPutUrl(key, "video/mp4", LINK_TTL_SECONDS, { cacheControl: RENDITION_CACHE_CONTROL });
    return { id: renditionId, key, url };
  }));
  return {
    status: 200,
    body: { source: { url: source, etag: data.source_etag }, uploads, contentType: "video/mp4", cacheControl: RENDITION_CACHE_CONTROL },
  };
}
