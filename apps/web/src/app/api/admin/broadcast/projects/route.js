import { authorizeBroadcastAdmin, broadcastResponse as response } from "@/lib/broadcast/admin-http";
import { getAdminClient } from "@/lib/supabase/admin";
import { projectCard } from "@/lib/broadcast/project-catalog";

export const dynamic = "force-dynamic";
const checked = (result) => { if (result.error) throw result.error; return result.data || []; };

export async function GET(req) {
  try {
    const access = await authorizeBroadcastAdmin(req);
    if (access.denial) return access.denial;
    const params = new URL(req.url).searchParams;
    const library = params.get("library") || "current";
    const page = Number(params.get("page") || 0);
    if (!["current", "unrelzd"].includes(library) || !Number.isSafeInteger(page) || page < 0 || page > 10000) return response({ error: "Invalid project page" }, 400);
    const client = getAdminClient();
    const from = page * 24;
    const releases = checked(await client.from("releases").select("*").eq("content_kind", "music")
      .in("status", library === "unrelzd" ? ["unrelzd"] : ["published", "scheduled"])
      .order("id").range(from, from + 24));
    const products = library === "current" ? checked(await client.from("products").select("*").eq("content_kind", "music")
      .eq("active", true).is("release_id", null).order("id").range(from, from + 24)) : [];
    const cards = [];
    // Serial batches bound DB concurrency and prevent loading an entire private catalog.
    for (const [kind, rows, table, foreign] of [["release", releases, "tracks", "release_id"], ["product", products, "catalog_tracks", "product_id"]]) {
      for (const row of rows.slice(0, 24)) {
        if (!projectCard(row, kind, 0)) continue;
        const result = await client.from(table).select("id", { count: "exact", head: true }).eq(foreign, row.id);
        if (result.error) throw result.error;
        cards.push(projectCard(row, kind, result.count));
      }
    }
    return response({ projects: cards, nextPage: releases.length > 24 || products.length > 24 ? page + 1 : null });
  } catch { return response({ error: "Project catalog unavailable" }, 503); }
}
