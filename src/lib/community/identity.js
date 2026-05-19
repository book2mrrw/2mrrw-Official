import {
  getActiveMembership,
  getCollectorAccessState,
  membershipHasPremiumAccess,
} from "@/lib/commerce/entitlements";

export function isCreatorUser(user) {
  const ids = String(process.env.CREATOR_USER_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
  const emails = String(process.env.CREATOR_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  return ids.includes(user.id) || emails.includes(String(user.email || "").toLowerCase());
}

export async function getCommunityIdentitySnapshot(admin, user) {
  const { data: libraryRows, error: libraryError } = await admin
    .from("library_items")
    .select("products(slug)")
    .eq("user_id", user.id);

  if (libraryError) throw libraryError;

  const legacyOwnedSlugs = (libraryRows || []).map((row) => row.products?.slug).filter(Boolean);
  const [membership, collectorAccess] = await Promise.all([
    getActiveMembership(user.id),
    getCollectorAccessState(admin, user.id, legacyOwnedSlugs),
  ]);

  const subscriber = membershipHasPremiumAccess(membership);
  const collector = collectorAccess.hasCollectorAccess;
  const innerCircle = subscriber || collector;
  const creator = isCreatorUser(user);
  const badge = creator
    ? "Creator"
    : subscriber && collector
      ? "Founder Collector"
      : subscriber
        ? "Subscriber"
        : collector
          ? "Founder Collector"
          : "Early Supporter";

  return {
    displayName: creator ? "2MRRW" : user.name || "Fan",
    badge,
    subscriber,
    collector,
    innerCircle,
    creator,
  };
}
