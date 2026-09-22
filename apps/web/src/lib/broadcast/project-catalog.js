const TYPES = new Set(["single", "feature", "album", "mixtape", "ep"]);
export function broadcastProjectType(row) {
  const value = row.release_type || row.product_type;
  return TYPES.has(value) ? value : null;
}

/** Explicit Admin DTO: object keys, draft payloads and private metadata stay on the server. */
export function projectCard(row, kind, trackCount) {
  const type = broadcastProjectType(row);
  if (!type || (row.content_kind && row.content_kind !== "music")) return null;
  if (kind === "release" && !["published", "scheduled", "unrelzd"].includes(row.status)) return null;
  if (kind === "product" && (!row.active || row.release_id)) return null;
  return {
    id: row.id, kind, title: row.title || row.metadata?.draft_title || row.slug || "Untitled project",
    type, status: kind === "release" ? row.status : "published",
    trackCount: trackCount || (["single", "feature"].includes(type) ? 1 : 0),
    artworkUrl: `/api/admin/broadcast/projects/${kind}/${encodeURIComponent(row.id)}/artwork`,
  };
}
