/**
 * Centralized Supabase auth layer — the ONLY client-side module that calls supabase.auth.
 *
 * Root causes addressed:
 * - Duplicate OTP sends from double-click, Enter+submit, and Strict Mode remounts
 * - Rate-limit storms from missing cooldown / single-flight guards
 * - Unstable sessions from scattered getSession/setSession/onAuthStateChange logic
 * - Re-auth loops from bootstrap running twice per hydration
 */

import { createClient } from "@/lib/supabase/client";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase/auth-storage-key";

const OTP_COOLDOWN_MS = 60_000;
/** Grace for clock skew when validating stored cooldown expiry timestamps. */
const OTP_COOLDOWN_MAX_SKEW_MS = 5_000;
/**
 * UX-only marker: "this device completed a real Supabase login before."
 * NEVER used as proof of authentication — session must come from supabase.auth only.
 */
const DEVICE_SESSION_KEY = "2mrrw-device-session";
const OTP_COOLDOWN_PREFIX = "2mrrw-otp-cooldown:";

/** @type {import("@supabase/supabase-js").SupabaseClient | null} */
let supabaseSingleton = null;

/** email → in-flight OTP promise (single-flight) */
const otpFlights = new Map();

/** email → cooldown expiry timestamp (memory) */
const otpCooldownUntil = new Map();

/** requestId → true (idempotency window) */
const otpSeenRequestIds = new Map();

/** Module-level bootstrap guard — survives React Strict Mode remounts. */
let bootstrapPromise = null;
let bootstrapComplete = false;

/** @type {import("@supabase/supabase-js").Subscription | null} */
let authSubscription = null;

/** @type {Set<(event: string, session: import("@supabase/supabase-js").Session | null) => void>} */
const authListeners = new Set();

function getSupabase() {
  if (!supabaseSingleton) {
    supabaseSingleton = createClient();
  }
  return supabaseSingleton;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * SAFETY: cooldown is timestamp-based only. Reject runaway future values so tampered
 * localStorage cannot cause a permanent OTP lockout; clear expired keys on read.
 */
function sanitizeCooldownUntil(until) {
  const n = Number(until) || 0;
  if (n <= 0) return 0;
  const now = Date.now();
  if (n <= now) return 0;
  const maxValid = now + OTP_COOLDOWN_MS + OTP_COOLDOWN_MAX_SKEW_MS;
  if (n > maxValid) return 0;
  return n;
}

function readStoredCooldownUntil(email) {
  if (typeof window === "undefined") return 0;
  const storageKey = `${OTP_COOLDOWN_PREFIX}${email}`;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return 0;
    const until = sanitizeCooldownUntil(raw);
    if (until === 0) {
      window.localStorage.removeItem(storageKey);
    }
    return until;
  } catch {
    return 0;
  }
}

function writeStoredCooldownUntil(email, until) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${OTP_COOLDOWN_PREFIX}${email}`, String(until));
  } catch {
    /* quota / private mode */
  }
}

function getCooldownUntil(email) {
  const key = normalizeEmail(email);
  if (!key) return 0;
  const now = Date.now();
  let mem = otpCooldownUntil.get(key) || 0;
  mem = sanitizeCooldownUntil(mem);
  if (mem === 0) {
    otpCooldownUntil.delete(key);
  }
  const stored = readStoredCooldownUntil(key);
  return Math.max(mem, stored);
}

function applyCooldown(email) {
  const key = normalizeEmail(email);
  if (!key) return;
  const until = Date.now() + OTP_COOLDOWN_MS;
  otpCooldownUntil.set(key, until);
  writeStoredCooldownUntil(key, until);
}

function createRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function rememberRequestId(requestId) {
  otpSeenRequestIds.set(requestId, Date.now());
  // Prune entries older than cooldown window
  const cutoff = Date.now() - OTP_COOLDOWN_MS;
  for (const [id, ts] of otpSeenRequestIds) {
    if (ts < cutoff) otpSeenRequestIds.delete(id);
  }
}

export function isOtpRateLimitError(err) {
  const status = err?.status ?? err?.code;
  if (status === 429 || status === "429") return true;
  const msg = String(err?.message || "");
  return /rate limit|too many requests|too many code|429/i.test(msg);
}

export function formatOtpSendError(err) {
  if (isOtpRateLimitError(err)) {
    return "Too many code requests. Wait a minute, then tap Send code again.";
  }
  return err?.message || "Could not send code";
}

export function getOtpCooldownRemainingMs(email) {
  const until = getCooldownUntil(normalizeEmail(email));
  return Math.max(0, until - Date.now());
}

function markDeviceAuthenticated(session) {
  if (typeof window === "undefined" || !session?.user?.id) return;
  try {
    window.localStorage.setItem(
      DEVICE_SESSION_KEY,
      JSON.stringify({
        userId: session.user.id,
        at: Date.now(),
      })
    );
  } catch {
    /* ignore */
  }
}

function readDeviceTrust() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEVICE_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearDeviceTrust() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DEVICE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

async function restoreSessionFromStorage(supabase) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const candidate =
      parsed?.access_token && parsed?.refresh_token
        ? parsed
        : parsed?.currentSession?.access_token
          ? parsed.currentSession
          : null;

    if (!candidate?.access_token || !candidate?.refresh_token) return null;

    const { data, error } = await supabase.auth.setSession({
      access_token: candidate.access_token,
      refresh_token: candidate.refresh_token,
    });

    if (error || !data?.session) return null;
    return data.session;
  } catch {
    return null;
  }
}

/**
 * Restore session once on load. Strict Mode safe via module-level bootstrapPromise.
 * @returns {Promise<{ session: import("@supabase/supabase-js").Session | null, source: string }>}
 */
export async function bootstrapSession() {
  if (bootstrapComplete) {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    return { session: data?.session || null, source: "cached" };
  }

  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const supabase = getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    let session = sessionData?.session || null;
    let source = session ? "cookie" : "none";

    // Device trust is UX-only (Safari ITP): prefer restore attempt label, never auth proof.
    const deviceTrust = readDeviceTrust();
    if (!session) {
      const restored = await restoreSessionFromStorage(supabase);
      if (restored) {
        session = restored;
        source = deviceTrust?.userId ? "localStorage-trusted" : "localStorage";
        // SAFETY: stale trust marker must not imply a different user is authenticated.
        if (deviceTrust?.userId && restored.user?.id !== deviceTrust.userId) {
          clearDeviceTrust();
        }
      }
    }

    if (session) {
      markDeviceAuthenticated(session);
    }

    if (!authSubscription) {
      const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (nextSession) {
          markDeviceAuthenticated(nextSession);
        }
        if (event === "SIGNED_OUT") {
          clearDeviceTrust();
        }
        for (const cb of authListeners) {
          try {
            cb(event, nextSession);
          } catch {
            /* listener error must not break auth */
          }
        }
      });
      authSubscription = listener?.subscription || null;
    }

    bootstrapComplete = true;
    return { session, source };
  })();

  return bootstrapPromise;
}

/**
 * Subscribe to auth state changes. Returns unsubscribe fn.
 * @param {(event: string, session: import("@supabase/supabase-js").Session | null) => void} callback
 */
export function subscribeAuthState(callback) {
  authListeners.add(callback);
  return () => {
    authListeners.delete(callback);
  };
}

/** Read-only session probe for redirect guards (login/join pages). */
export async function getAuthenticatedUser() {
  const { session } = await bootstrapSession();
  const user = session?.user;
  if (!user?.email || user.email.endsWith("@guest.2mrrw.local")) return null;
  return user;
}

/**
 * Send email OTP — single-flight, idempotent, 60s cooldown, no auto-retry.
 * @param {{ email: string, shouldCreateUser?: boolean, requestId?: string }} options
 */
export async function sendEmailOtp({ email, shouldCreateUser = false, requestId } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { data: null, error: { message: "Email required" } };
  }

  const id = requestId || createRequestId();

  // Idempotency: duplicate requestId from same user action → silent no-op success
  if (otpSeenRequestIds.has(id)) {
    return { data: null, error: null, deduplicated: true };
  }

  const cooldownRemaining = getOtpCooldownRemainingMs(normalized);
  if (cooldownRemaining > 0) {
    return {
      data: null,
      error: {
        message: formatOtpSendError({ status: 429 }),
        status: 429,
      },
      cooldownMs: cooldownRemaining,
    };
  }

  // Single-flight: concurrent calls for same email share one network request
  if (otpFlights.has(normalized)) {
    return otpFlights.get(normalized);
  }

  rememberRequestId(id);

  const flight = (async () => {
    // Cooldown starts at attempt time — prevents rapid re-fire even on failure
    applyCooldown(normalized);

    const supabase = getSupabase();
    const result = await supabase.auth.signInWithOtp({
      email: normalized,
      options: { shouldCreateUser },
    });

    // Never auto-retry on rate limit or any error
    return result;
  })();

  otpFlights.set(normalized, flight);

  try {
    return await flight;
  } finally {
    otpFlights.delete(normalized);
  }
}

/**
 * Verify email OTP token.
 * @param {{ email: string, token: string, type?: string }} options
 */
export async function verifyEmailOtp({ email, token, type = "email" }) {
  const supabase = getSupabase();
  const result = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token,
    type,
  });

  if (result.data?.session) {
    markDeviceAuthenticated(result.data.session);
  }

  return result;
}

export async function signOut() {
  clearDeviceTrust();
  const supabase = getSupabase();
  return supabase.auth.signOut();
}

/** @deprecated Use authService exports directly — kept for gradual migration */
export const authService = {
  bootstrapSession,
  subscribeAuthState,
  getAuthenticatedUser,
  sendEmailOtp,
  verifyEmailOtp,
  signOut,
  getOtpCooldownRemainingMs,
  isOtpRateLimitError,
  formatOtpSendError,
};
