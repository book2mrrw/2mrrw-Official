import crypto from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const MFA_AUTHORITY_TTL_SECONDS = 12 * 60 * 60;
export const RECENT_MFA_SECONDS = 15 * 60;
const cookieName = () => process.env.NODE_ENV === "production" ? "__Host-2mrrw_mfa" : "2mrrw_mfa_dev";
const cookieOptions = (maxAge = MFA_AUTHORITY_TTL_SECONDS) => ({ httpOnly: true,
  secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge });
const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");

function claims(token) {
  try {
    const part = String(token || "").split(".")[1];
    return part ? JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) : null;
  } catch { return null; }
}
export function authSessionId(session) {
  const id = claims(session?.access_token)?.session_id;
  return typeof id === "string" && id.length >= 8 ? id : null;
}
export const customMfaRequired = () =>
  String(process.env.HUMAN_ADMIN_MFA_REQUIRED || "").trim().toLowerCase() === "true";

export async function issueMfaAuthority({ userId, session }) {
  const sessionId = authSessionId(session);
  if (!userId || session?.user?.id !== userId || !sessionId) throw new Error("mfa_session_binding_unavailable");
  const token = crypto.randomBytes(32).toString("base64url");
  const { data, error } = await getAdminClient().rpc("issue_2mrrw_mfa_authority", {
    p_user_id: userId, p_token_hash: hashToken(token), p_auth_session_id: sessionId,
    p_ttl_seconds: MFA_AUTHORITY_TTL_SECONDS,
  });
  const authority = Array.isArray(data) ? data[0] : data;
  if (error || !authority?.authority_id) throw new Error("mfa_authority_issue_failed");
  (await cookies()).set(cookieName(), token, cookieOptions());
  return authority;
}

export async function verifyMfaAuthority({ userId, recentSeconds = null } = {}) {
  if (!customMfaRequired()) return { ok: false, reason: "custom_mfa_configuration_missing" };
  const token = (await cookies()).get(cookieName())?.value || "";
  if (!token || !userId) return { ok: false, reason: "custom_mfa_required" };
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const sessionId = authSessionId(session);
  if (!session || session.user?.id !== userId || !sessionId) return { ok: false, reason: "custom_mfa_session_mismatch" };
  const { data, error } = await getAdminClient().rpc("verify_2mrrw_mfa_authority", {
    p_user_id: userId, p_token_hash: hashToken(token), p_auth_session_id: sessionId,
  });
  const authority = Array.isArray(data) ? data[0] : data;
  if (error || !authority?.authority_id) return { ok: false, reason: "custom_mfa_invalid" };
  if (recentSeconds != null) {
    const age = (Date.now() - new Date(authority.verified_at).getTime()) / 1000;
    if (!Number.isFinite(age) || age > recentSeconds) return { ok: false, reason: "recent_custom_mfa_required", authority };
  }
  return { ok: true, authority, sessionId };
}

export async function revokeCurrentMfaAuthority(reason = "sign_out") {
  const store = await cookies();
  const name = cookieName();
  const token = store.get(name)?.value || "";
  try {
    if (token) await getAdminClient().rpc("revoke_2mrrw_mfa_authority", {
      p_token_hash: hashToken(token), p_reason: reason,
    });
  } finally { store.set(name, "", cookieOptions(0)); }
}

/**
 * Invalidate every 2MRRW MFA authority for one immutable principal without
 * enumerating browser sessions. This is a server-only security-reset primitive.
 */
export async function resetMfaAuthorityForUser(userId, reason = "security_reset") {
  if (!userId) throw new Error("mfa_reset_user_required");
  const { data, error } = await getAdminClient().rpc("bump_2mrrw_mfa_generation", {
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) throw new Error("mfa_authority_reset_failed");
  return data;
}
