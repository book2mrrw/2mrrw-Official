import { getAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/auth/constants";
import { userOwnsProduct, userCanStreamProduct } from "@/lib/commerce/entitlements";
import { releaseAvailability } from "@/lib/releases/release-availability";

const RELEASE_FIELDS = "id,status,scheduled_at,available_at,storefront_visible,upcoming_visible,preview_before_release,preorder_enabled,preorder_starts_at,preorder_price_cents,early_access_enabled,early_access_starts_at,early_access_scope,early_access_audiences,unavailable_at";

export async function resolveReleaseAccessForProduct({ slug, user, trackId = null, now = new Date() }) {
  const admin = getAdminClient();
  const { data: product, error } = await admin
    .from("products")
    .select(`id,slug,release_id,releases(${RELEASE_FIELDS})`)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!product) return { product: null, release: null, availability: null };

  const release = Array.isArray(product.releases) ? product.releases[0] : product.releases;
  // Legacy catalog products without a release link keep their existing behavior.
  if (!release) return { product, release: null, availability: null };
  const adminUser = Boolean(user && isAdminUser(user));
  const [owned, normallyEntitled] = user?.id && !adminUser
    ? await Promise.all([userOwnsProduct(user.id, slug), userCanStreamProduct(user.id, slug, user)])
    : [adminUser, adminUser];
  let preorderOwned = false;
  if (owned && user?.id && !adminUser) {
    const { data: preorderEntitlement } = await admin
      .from("entitlements")
      .select("id")
      .eq("user_id", user.id)
      .eq("resource_type", "product")
      .eq("resource_id", product.id)
      .eq("status", "active")
      .eq("metadata->>access_type", "preorder")
      .limit(1)
      .maybeSingle();
    preorderOwned = Boolean(preorderEntitlement);
  }
  const availability = releaseAvailability(release, {
    admin: adminUser,
    owned,
    preorderOwned,
    normallyEntitled,
  }, now);

  if (availability.canPlayFull && availability.scope?.mode === "selected_tracks") {
    const allowed = new Set(availability.scope.track_ids || []);
    availability.canPlayFull = Boolean(trackId && allowed.has(trackId));
  }
  return { product, release, availability };
}
