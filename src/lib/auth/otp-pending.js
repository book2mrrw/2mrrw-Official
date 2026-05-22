export const PENDING_PHONE_KEY = "2mrrw_pending_profile_phone";

export function readPendingPhone() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(PENDING_PHONE_KEY) || "";
  } catch {
    return "";
  }
}

export function writePendingPhone(phone) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PENDING_PHONE_KEY, String(phone || "").trim());
  } catch {
    /* ignore */
  }
}

export function clearPendingPhone() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PENDING_PHONE_KEY);
  } catch {
    /* ignore */
  }
}
