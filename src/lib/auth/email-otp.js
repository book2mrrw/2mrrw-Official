/**
 * User-initiated email OTP send only. Call from click/submit handlers — never from useEffect on mount.
 */

export function isOtpRateLimitError(err) {
  const status = err?.status ?? err?.code;
  if (status === 429 || status === "429") return true;
  const msg = String(err?.message || "");
  return /rate limit|too many requests|429/i.test(msg);
}

export function formatOtpSendError(err) {
  if (isOtpRateLimitError(err)) {
    return "Too many code requests. Wait a minute, then tap Send code again.";
  }
  return err?.message || "Could not send code";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ email: string, shouldCreateUser?: boolean }} options
 */
export async function sendEmailOtp(supabase, { email, shouldCreateUser = false }) {
  return supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser },
  });
}
