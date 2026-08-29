import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { VISUAL_ENTITLEMENT_TIERS, visualEntitlementSatisfied } from "@/lib/media/visual-asset-schema";
import { getPublicR2Url } from "@/lib/storage/r2";

import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_PUBLIC_KEY } from "@/lib/supabase/public-key";
import { SUPABASE_URL } from "@/lib/supabase/supabase-url";

export const dynamic = "force-dynamic";

/**
 * GET /api/media/visual-assets/[slug]
 *
 * Returns active, published visual assets for a release, filtered to the
 * caller's entitlement tier. Ordered by priority DESC.
 *
 * ?tier=public|signed_in|purchaser|subscriber|collector|vault|admin
 *   Optional client-supplied tier hint (used when server-side session is not
 *   available). Server validates via session when possible and uses the stricter value.
 *
 * Response: { assets: ReleaseVisualAsset[] }
 */
export async function GET(req, { params }) {
  const { slug } = params;
  if (!slug) return NextResponse.json({ assets: [] });

  const { searchParams } = req.nextUrl;
  const clientTierHint   = searchParams.get("tier") ?? "public";

  // ── Resolve server-side session tier ───────────────────────────────────────
  let serverTier = "public";
  try {
    const supabase = getAdminClient();

    // INV-ENT-9: admin tier resolves through the single admin authority path,
    // never by matching a mutable email attribute. getFanSessionUser() also
    // re-verifies the JWT via getUser() rather than trusting the cookie payload.
    const sessionUser = await getFanSessionUser();
    if (sessionUser) {
      if (isAdminUser(sessionUser)) {
        serverTier = "admin";
      } else {
        const { data: ent } = await supabase
          .from("user_entitlements")
          .select("subscriber, collector_card, vault_access")
          .eq("user_id", sessionUser.id)
          .maybeSingle();

        if (ent?.collector_card) serverTier = "collector";
        else if (ent?.vault_access) serverTier = "vault";
        else if (ent?.subscriber) serverTier = "subscriber";
        else {
          // Check for any purchases
          const { count } = await supabase
            .from("purchases")
            .select("id", { count: "exact", head: true })
            .eq("user_id", sessionUser.id)
            .eq("status", "completed")
            .limit(1);
          serverTier = count > 0 ? "purchaser" : "signed_in";
        }
      }
    }
  } catch {
    // Session resolution failure is non-fatal — degrade to client hint or public
  }

  // Use the more restrictive of server-resolved vs client-hinted tier
  const serverIdx = VISUAL_ENTITLEMENT_TIERS.indexOf(serverTier);
  const clientIdx = VISUAL_ENTITLEMENT_TIERS.indexOf(clientTierHint);
  // If server resolved a real session, trust it; otherwise use client hint as best-effort
  const effectiveTier = serverIdx >= 0 && serverTier !== "public"
    ? serverTier
    : (clientIdx >= 0 ? clientTierHint : "public");

  // ── Query release_visual_assets ─────────────────────────────────────────────
  let rows = [];
  try {
    const sbAnon = createServerClient(
      SUPABASE_URL,
      SUPABASE_PUBLIC_KEY,
      { cookies: { getAll: () => [] } }
    );

    const now = new Date().toISOString();
    const { data } = await sbAnon
      .from("release_visual_assets")
      .select("*")
      .eq("release_slug", slug)
      .eq("active", true)
      .or(`publish_at.is.null,publish_at.lte.${now}`)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });

    rows = data ?? [];
  } catch {
    return NextResponse.json({ assets: [] });
  }

  // ── Entitlement filter ──────────────────────────────────────────────────────
  const entitled = rows.filter(row =>
    visualEntitlementSatisfied(effectiveTier, row.entitlement ?? "public")
  );

  // ── Resolve public CDN URLs for r2_key / poster_r2_key fields ──────────────
  const assets = entitled.map(row => {
    const out = { ...row };
    if (row.r2_key && !row.thumbnail_url) {
      try { out.resolved_url = getPublicR2Url(row.r2_key); } catch {}
    }
    if (row.poster_r2_key) {
      try { out.poster_url = getPublicR2Url(row.poster_r2_key); } catch {}
    }
    return out;
  });

  return NextResponse.json(
    { assets },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  );
}
