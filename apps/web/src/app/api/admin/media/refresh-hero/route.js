/**
 * POST /api/admin/media/refresh-hero
 *
 * Signals that the hero video has been replaced in R2.
 * Purges the Cloudflare CDN cache for the hero MP4 so all users
 * get the new file without waiting for the TTL to expire.
 *
 * The client additionally dispatches "2mrrw-hero-refresh" so the
 * admin's own browser reloads the video element immediately.
 *
 * Admin-only.
 */

import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST() {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) return json({ error: "Forbidden" }, 403);

  const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "";
  const videoUrl = `${r2PublicUrl}/videos/A2B.mp4`;

  const steps = { cachePurged: false };

  // ── Cloudflare Cache Purge ───────────────────────────────────────────────────
  // Only runs if the Cloudflare Zone ID + API token are configured.
  // Without these, the CDN cache expires naturally based on Cache-Control headers.
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;

  if (zoneId && cfToken && videoUrl) {
    try {
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${cfToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ files: [videoUrl] }),
        }
      );
      const data = await resp.json();
      steps.cachePurged = Boolean(data?.success);
    } catch (err) {
      console.warn("[refresh-hero] Cloudflare purge failed", err?.message);
    }
  }

  return json({ ok: true, videoUrl, steps });
}
