import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const COOKIE_NAME = "guest_session";
const ONE_YEAR = 60 * 60 * 24 * 365;

function secret() {
  return process.env.GUEST_SESSION_SECRET || process.env.ADMIN_SEED_SECRET || process.env.STRIPE_SECRET_KEY;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").trim();
}

function signGuestId(guestId) {
  const key = secret();
  if (!key) throw new Error("Missing GUEST_SESSION_SECRET or fallback secret");
  return crypto.createHmac("sha256", key).update(guestId).digest("hex");
}

function encodeGuestCookie(guestId) {
  return `${guestId}.${signGuestId(guestId)}`;
}

function syntheticAuthEmail(email, phone) {
  const digest = crypto
    .createHash("sha256")
    .update(`${email}:${phone}`)
    .digest("hex")
    .slice(0, 24);
  return `guest-${digest}@guest.2mrrw.local`;
}

function decodeGuestCookie(value) {
  const [guestId, sig] = String(value || "").split(".");
  if (!guestId || !sig) return null;
  const expected = signGuestId(guestId);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return guestId;
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

export async function getGuestUser() {
  const guestId = await getGuestIdFromCookie();
  if (!guestId) return null;

  const admin = createAdminClient();
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

async function findGuestBySyntheticEmail(admin, syntheticEmail) {
  let page = 1;
  const perPage = 1000;
  while (page < 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data?.users?.find((user) => user.email === syntheticEmail);
    if (found) return found;
    if (!data?.users?.length || data.users.length < perPage) return null;
    page += 1;
  }
  return null;
}

export async function createOrRetrieveGuest({ email, phone, name }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const fullName = String(name || "").trim();

  if (!normalizedEmail || !normalizedPhone) {
    throw new Error("Email and phone are required");
  }

  const admin = createAdminClient();
  const syntheticEmail = syntheticAuthEmail(normalizedEmail, normalizedPhone);

  const existing = await findGuestBySyntheticEmail(admin, syntheticEmail);
  if (existing) {
    const metadata = existing.user_metadata || {};
    if (fullName && metadata.full_name !== fullName) {
      await admin.auth.admin.updateUserById(existing.id, {
        user_metadata: { ...metadata, full_name: fullName },
      });
      metadata.full_name = fullName;
    }
    return {
      id: existing.id,
      email: metadata.contact_email || normalizedEmail,
      phone: metadata.phone || normalizedPhone,
      name: metadata.full_name || fullName || "Fan",
      badge: "Early Supporter",
      isGuest: true,
      createdAt: existing.created_at,
    };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    // Supabase Auth enforces unique email globally. The product identity key is
    // email + phone, so the hidden auth row uses a synthetic email while the
    // real contact details live in public.profiles.
    email: syntheticEmail,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      contact_email: normalizedEmail,
      phone: normalizedPhone,
      guest: true,
    },
  });

  if (createError) throw createError;

  return {
    id: created.user.id,
    email: normalizedEmail,
    phone: normalizedPhone,
    name: fullName || "Fan",
    badge: "Early Supporter",
    isGuest: true,
    createdAt: created.user.created_at,
  };
}
