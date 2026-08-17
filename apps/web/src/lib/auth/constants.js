export const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "";
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").toLowerCase();

export function isAdminUser(user) {
  if (!user) return false;
  // Strongest: immutable UUID — set ADMIN_USER_ID in env to lock by Supabase identity
  if (ADMIN_USER_ID && user.id === ADMIN_USER_ID) return true;
  // Cryptographic: JWT role claim in app_metadata — set by SQL, signed by Supabase
  if (user.app_metadata?.role === "admin") return true;
  // Mapped role: getFanSessionUser() normalises app_metadata.role → user.role
  if (user.role === "admin") return true;
  // Email fallback: retained for backward compat and local dev without ADMIN_USER_ID
  if (ADMIN_EMAIL) {
    for (const candidate of [user.email, user.authEmail]) {
      const email = String(candidate || "").trim().toLowerCase();
      if (email && email === ADMIN_EMAIL) return true;
    }
  }
  return false;
}
