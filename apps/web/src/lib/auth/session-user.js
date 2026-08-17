import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getGuestUser } from "@/lib/guest-session";

// Per-user in-process profile cache. The profile row (email, phone, name, role)
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

export async function getFanSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email && !user.email.endsWith("@guest.2mrrw.local")) {
    const metaRole =
      user.app_metadata?.role ||
      user.user_metadata?.role ||
      null;

    let profile = getCachedProfile(user.id);
    if (!profile) {
      const admin = getAdminClient();
      const { data } = await admin
        .from("profiles")
        .select("email, phone, full_name, role")
        .eq("id", user.id)
        .maybeSingle();
      profile = data || null;
      setCachedProfile(user.id, profile);
    }

    return {
      id: user.id,
      email: profile?.email || user.email,
      authEmail: user.email || "",
      phone: profile?.phone || "",
      name: profile?.full_name || "",
      isGuest: false,
      isOtp: true,
      role: [profile?.role, metaRole].find((r) => r === "admin") ?? profile?.role ?? "user",
    };
  }

  const guest = await getGuestUser();
  if (guest) return guest;
  return null;
}
