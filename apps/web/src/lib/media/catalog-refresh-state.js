import { createHash } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { releaseAvailability } from "@/lib/releases/release-availability";

// An opaque change token: lyrics, drafts, allocations, audio URLs and private
// release identities never leave this server owner.
const SOURCES = {
  products: "id,updated_at,active,deleted_at",
  releases: "id,updated_at,status,deleted_at,available_at,scheduled_at,unavailable_at,storefront_visible,upcoming_visible,preview_before_release,preorder_enabled,preorder_starts_at,early_access_enabled,early_access_starts_at",
  tracks: "id,updated_at,removed_from_release_at",
  catalog_tracks: "id,updated_at,removed_from_release_at",
};

async function readVersions(admin, table, columns) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from(table).select(columns).order("id").range(offset, offset + 999);
    if (error || !Array.isArray(data)) throw error || new Error("Catalog revision unavailable");
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function getCatalogRefreshStateFromDB(admin = getAdminClient(), now = new Date()) {
  const versions = await Promise.all(Object.entries(SOURCES).map(async ([table, columns]) => {
    const rows = await readVersions(admin, table, columns);
    return [table, rows.map(row => table === "releases"
      ? { ...row, availability: releaseAvailability(row, {}, now) }
      : row)];
  }));
  return { revision: createHash("sha256").update(JSON.stringify(versions)).digest("hex") };
}
