import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";

const COOKIE_NAME = "guest_session";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Guest-cookie signing keys.
 *
 * ── INV-ENT-17: one secret, one trust domain ────────────────────────────────
 *
 * This previously fell back to ADMIN_SEED_SECRET, which is simultaneously the
 * bearer credential for eleven privileged API routes and — until E1 — was typed
 * into a browser prompt on the admin gifts page. That made a server master
 * secret capable of FORGING GUEST SESSION COOKIES FOR ANY USER ID, because
 * getGuestUser() resolves whatever id the signed cookie names.
 *
 * The fallback is removed. Signing now requires a dedicated
 * GUEST_SESSION_SECRET and nothing else.
 *
 * ── Rotation (same dual-key scheme as lib/hls/token.js) ─────────────────────
 *   SIGN:   always GUEST_SESSION_SECRET
 *   VERIFY: GUEST_SESSION_SECRET, then GUEST_SESSION_SECRET_PREVIOUS
 *
 * To cut over without logging every guest out, set
 * GUEST_SESSION_SECRET_PREVIOUS to the old value (the ADMIN_SEED_SECRET the
 * cookies were signed with) for one cookie lifetime, then remove it.
 *
 * Fails CLOSED: with no current secret, signing throws and verification
 * returns null, so no cookie is ever minted or accepted.
 */
function secret() {
  return process.env.GUEST_SESSION_SECRET || "";
}

function previousSecret() {
  return process.env.GUEST_SESSION_SECRET_PREVIOUS || "";
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").trim();
}

function signGuestId(guestId, key = secret()) {
  if (!key) {
    throw new Error(
      "GUEST_SESSION_SECRET is required. The ADMIN_SEED_SECRET fallback was removed " +
      "in E1 — a secret that signs session cookies must not also be an admin bearer token."
    );
  }
  return crypto.createHmac("sha256", key).update(guestId).digest("hex");
}

function encodeGuestCookie(guestId) {
  return `${guestId}.${signGuestId(guestId)}`;
}

/**
 * Verify a guest cookie against the current key, then the previous one.
 *
 * Returns null on any failure — including a length mismatch, which previously
 * reached crypto.timingSafeEqual and threw a RangeError on attacker-supplied
 * input. Callers wrapped that in try/catch so it failed closed, but the
 * function's contract said "returns null", and a future caller trusting that
 * would have 500'd on a malformed cookie.
 */
function verifyAgainst(guestId, sig, key) {
  if (!key) return false;
  let expected;
  try { expected = signGuestId(guestId, key); } catch { return false; }
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function decodeGuestCookie(value) {
  const [guestId, sig] = String(value || "").split(".");
  if (!guestId || !sig) return null;
  if (verifyAgainst(guestId, sig, secret())) return guestId;
  // Rotation window: accept cookies signed with the previous key.
  if (verifyAgainst(guestId, sig, previousSecret())) return guestId;
  return null;
}

export function withGuestCookie(response, guestId, options = {}) {
  const maxAge = options.remember === false ? 60 * 60 * 24 * 7 : ONE_YEAR;
  response.cookies.set(COOKIE_NAME, encodeGuestCookie(guestId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return response;
}

export async function getGuestSessionCookieState() {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) {
    return { remember: false, expired: false };
  }
  try {
    const guestId = decodeGuestCookie(raw);
    if (!guestId) {
      return { remember: false, expired: true };
    }
    return { remember: true, expired: false, guestId };
  } catch {
    return { remember: false, expired: true };
  }
}

export function clearGuestCookieOnResponse(response) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export function clearGuestCookie(body = { ok: true }) {
  return clearGuestCookieOnResponse(NextResponse.json(body));
}

export async function getGuestIdFromCookie() {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return decodeGuestCookie(raw);
  } catch {
    return null;
  }
}

/**
 * Unified user resolver for API routes.
 * Checks the Supabase session (new email+password auth) first,
 * falls back to the legacy guest_session cookie.
 * Returns null only if neither is present.
 */
export async function getRequestUser() {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (!error && data?.user?.id) {
      const u = data.user;
      const meta = u.user_metadata || {};
      return {
        id: u.id,
        email: meta.contact_email || u.email || "",
        phone: meta.phone || u.phone || "",
        name: meta.full_name || meta.name || "",
        isGuest: false,
        createdAt: u.created_at,
      };
    }
  } catch {
    // fall through to guest session
  }
  return getGuestUser();
}

/**
 * Resolve the guest user for the current request.
 *
 * @param {{ overrideId?: string }} [opts] `overrideId` is for the possession-proof
 *   flow only, where the server has just verified a challenge and needs to load
 *   the account before minting its cookie. It is never derived from client input.
 */
export async function getGuestUser({ overrideId = null } = {}) {
  const guestId = overrideId || (await getGuestIdFromCookie());
  if (!guestId) return null;

  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(guestId);
  if (error) throw error;
  if (!data?.user) return null;

  const metadata = data.user.user_metadata || {};

  return {
    id: data.user.id,
    email: metadata.contact_email || data.user.email || "",
    phone: metadata.phone || "",
    name: metadata.full_name || "Fan",
    badge: "Early Supporter",
    isGuest: true,
    createdAt: data.user.created_at,
  };
}
