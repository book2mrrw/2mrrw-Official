export const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "";
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").toLowerCase();

export function isAdminUser(user) {
  if (!user) return false;
  if (user.id === ADMIN_USER_ID) return true;
  if (user.role === "admin") return true;
  const adminEmail = ADMIN_EMAIL.toLowerCase();
  for (const candidate of [user.email, user.authEmail]) {
    const email = String(candidate || "").trim().toLowerCase();
    if (email && email === adminEmail) return true;
  }
  return false;
}
