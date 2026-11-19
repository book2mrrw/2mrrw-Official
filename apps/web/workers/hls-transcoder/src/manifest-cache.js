/**
 * Tell the website a manifest was just published, so its L1+L2 manifest
 * cache serves the new one now instead of after its TTL (up to 24 h).
 * Best-effort: a refused or failed notice is logged, never thrown — the
 * publication itself is already committed.
 */
export async function notifyManifestPublished({ slug, trackSlug = null }, { fetchFn = fetch, env = process.env } = {}) {
  const appUrl = env.APP_URL;
  const workerToken = env.HLS_WORKER_API_TOKEN;
  if (!appUrl || !workerToken) return false;
  try {
    const response = await fetchFn(`${appUrl}/api/admin/hls/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slug, trackSlug }),
    });
    if (!response.ok) console.warn("[worker] cache invalidation notify rejected", response.status);
    return response.ok;
  } catch (err) {
    console.warn("[worker] cache invalidation notify failed", err?.message);
    return false;
  }
}
