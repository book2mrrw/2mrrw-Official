import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getGuestUser } from "@/lib/guest-session";
import { isAdminPrincipal } from "@/lib/auth/admin-authority";

// Per-user in-process profile cache. The profile row (email, phone, name)
// changes rarely — 30 s TTL halves DB calls for every authenticated route without
// meaningful staleness risk. Same pattern as account-state route.
const _profileCache = new Map();
const PROFILE_CACHE_TTL_MS = 30_000;
const PROFILE_CACHE_MAX = 500;

function getCachedProfile(userId) {
  const entry = _profileCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _profileCache.delete(userId); return null; }
  return entry.data;
}

function setCachedProfile(userId, data) {
  _profileCache.set(userId, { data, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
  if (_profileCache.size > PROFILE_CACHE_MAX) {
    const oldest = _profileCache.keys().next().value;
    if (oldest !== undefined) _profileCache.delete(oldest);
  }
}

export function invalidateProfileCache(userId) {
  if (userId) _profileCache.delete(userId);
}

/**
 * Resolve the authenticated fan session user.
 *
 * ADMIN AUTHORITY (INV-ENT-1 / INV-ENT-2):
 *   `isAdmin` is resolved here, once, from trusted server-controlled sources
 *   only — the admin_principals table plus deployment-pinned env identity and
 *   the service-role-only app_metadata claim. Downstream code reads the
 *   resolved boolean through isAdminUser().
 *
 *   Two sources are deliberately NOT consulted:
 *     user_metadata.role  — writable by the user via supabase.auth.updateUser()
 *     profiles.role       — was client-writable through profiles_update_own RLS
 *
 *   `role` is still returned for display and for legacy consumers, but it is
 *   derived from the resolved authority rather than trusted as an input.
 */
export async function getFanSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email && !user.email.endsWith("@guest.2mrrw.local")) {
    let profile = getCachedProfile(user.id);
    if (!profile) {
      const admin = getAdminClient();
      const { data } = await admin
        .from("profiles")
        .select("email, phone, full_name")
        .eq("id", user.id)
        .maybeSingle();
      profile = data || null;
      setCachedProfile(user.id, profile);
    }

    // Trusted resolution. app_metadata comes from the verified JWT; the
    // admin_principals lookup is server-only and fails closed.
    const isAdmin = await isAdminPrincipal({
      id: user.id,
      email: profile?.email || user.email,
      authEmail: user.email || "",
      app_metadata: user.app_metadata,
    });

    return {
      id: user.id,
      email: profile?.email || user.email,
      authEmail: user.email || "",
      phone: profile?.phone || "",
      name: profile?.full_name || "",
      isGuest: false,
      isOtp: true,
      isAdmin,
      role: isAdmin ? "admin" : "user",
    };
  }

  const guest = await getGuestUser();
  if (guest) return guest;
  return null;
}
