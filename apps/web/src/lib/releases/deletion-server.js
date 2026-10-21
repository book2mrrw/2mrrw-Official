import { getAdminClient } from "@/lib/supabase/admin";

// Deliberately uncached. Every response/refresh sees committed tombstones;
// database errors must fail closed rather than resurrecting bundled content.
export async function getDeletedReleaseSlugs(admin = getAdminClient()) {
  const slugs = new Set();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from("release_deletions")
      .select("slug").order("slug").range(offset, offset + 999);
    if (error) throw error;
    for (const row of data || []) slugs.add(row.slug);
    if ((data || []).length < 1000) return slugs;
  }
}
