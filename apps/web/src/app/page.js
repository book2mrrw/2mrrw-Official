import { getAdminClient } from "@/lib/supabase/admin";
import { getStorefrontCatalogFromDB } from "@/lib/media/catalog-db";
import { fetchUpcomingShows } from "@/lib/shows/upcoming-shows";
import HomeClient from "./HomeClient";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireConsumerPrincipal } from "@/lib/auth/consumer-authority";
import { loginRedirectPath } from "@/lib/auth/route-access-policy";

// Revalidate the page every hour so events stay fresh without a full rebuild.
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fetchEvents() {
  try {
    return await fetchUpcomingShows(getAdminClient());
  } catch {
    return [];
  }
}

export default async function Page() {
  const principal = await requireConsumerPrincipal();
  if (!principal) redirect(loginRedirectPath("/"));

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "www.2mrrw.com";
  const requestedParent = forwardedHost.split(",")[0].trim().split(":")[0].toLowerCase();
  const twitchEmbedParent = requestedParent === "www.2mrrw.com" || requestedParent === "localhost" || requestedParent.endsWith(".vercel.app")
    ? requestedParent
    : "www.2mrrw.com";
  const twitchBroadcasterLogin = /^[a-zA-Z0-9_]{1,25}$/.test(process.env.TWITCH_BROADCASTER_LOGIN || "")
    ? process.env.TWITCH_BROADCASTER_LOGIN
    : "callme2mrrw";

  // Fetch in parallel — catalog DB failure is non-fatal (HomeClient falls back to hardcoded arrays).
  const [events, initialCatalog] = await Promise.all([
    fetchEvents(),
    getStorefrontCatalogFromDB(),
  ]);
  return (
    <HomeClient
      initialEvents={events}
      initialCatalog={initialCatalog}
      twitchEmbedParent={twitchEmbedParent}
      twitchBroadcasterLogin={twitchBroadcasterLogin}
    />
  );
}
