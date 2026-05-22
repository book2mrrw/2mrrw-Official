const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePhoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

export function validateEmail(email) {
  const value = String(email || "").trim();
  if (!value) return { ok: false, error: "Please enter a valid email address" };
  if (!EMAIL_RE.test(value)) return { ok: false, error: "Please enter a valid email address" };
  return { ok: true, value: value.toLowerCase() };
}

export function validatePhone(phone) {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 10) return { ok: false, error: "Please enter a valid phone number" };
  return { ok: true, value: phone.trim(), digits };
}

export function formatResendCountdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
