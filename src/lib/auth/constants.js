export const ADMIN_USER_ID = "545cd959-5cae-4009-8a91-1c46fe2f4d27";
export const ADMIN_EMAIL = "book2mrrw@gmail.com";

export function isAdminUser(user) {
  if (!user) return false;
  if (user.id === ADMIN_USER_ID) return true;
  if (user.role === "admin") return true;
  const email = String(user.email || "").trim().toLowerCase();
  return email === ADMIN_EMAIL.toLowerCase();
}
