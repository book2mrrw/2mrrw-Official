/**
 * admin-authority — the single server-side resolver for administrative authority.
 *
 * INV-ENT-1   User-controlled profile/auth metadata can never grant admin authority.
 * INV-ENT-2   Admin capability originates only from server-controlled state.
 * INV-ENT-9   Admin authority binds only to IMMUTABLE PRINCIPAL IDENTITY.
 * INV-ENT-11  Admin revocation takes effect immediately across all instances.
 *
 * ── Trust classification (locked) ───────────────────────────────────────────
 *
 *   TRUSTED — immutable principal identity, no client write path
 *     admin_principals table     service_role only; RLS on, zero policies
 *     ADMIN_USER_ID env          deployment-pinned Supabase user UUID
 *     app_metadata.role          service-key-only JWT claim
 *
 *   REJECTED — mutable or client-writable
 *     ADMIN_EMAIL env            email is mutable and re-assignable; an address
 *                                can change owner, and matching on it binds
 *                                authority to a mutable attribute (INV-ENT-9)
 *     user_metadata.role         self-service via supabase.auth.updateUser()
 *     profiles.role              was client-writable via profiles_update_own RLS
 *     any request body / header / cookie / localStorage claim
 *
 * Seeding the first admin is an operator action, not a runtime path: call
 * public.bootstrap_admin_by_email() once from a privileged SQL session, or set
 * ADMIN_USER_ID. See migration 20260822000010.
 *
 * ── Immediate revocation (INV-ENT-11) ───────────────────────────────────────
 *
 * A positive admin decision is cached in-process for latency, but the cache is
 * validated against the user's entitlement generation on every read. Revoking
 * admin bumps that generation, so every instance's cached grant becomes stale at
 * once — there is no window in which a revoked administrator retains access
 * because one instance happens to hold a warm positive entry.
 *
 * Admin membership is deliberately folded into the SAME generation counter as
 * entitlements rather than getting its own: gaining or losing admin changes
 * effective rights, so it must move the capability version too (INV-ENT-7).
 *
 * Failure mode: if the generation cannot be read, the cache is NOT used and the
 * decision is recomputed from the database. Never a default-allow (INV-ENT-8).
 */

import { getAdminClient } from "@/lib/supabase/admin";
import {
  getEntitlementGeneration,
  bumpEntitlementGeneration,
} from "@/lib/server/entitlement-cache";

/**
 * Local copy of the missing-table predicate.
 *
 * Intentionally NOT imported from @/lib/commerce/entitlements: that module
 * imports isAdminUserId() from here, and an ESM cycle between an auth primitive
 * and the entitlement resolver is a fragile place to rely on hoisting order.
 */
function isMissingSupabaseTable(error) {
  const code = error?.code || "";
  return code === "42P01" || /relation .* does not exist/i.test(String(error?.message || ""));
}

const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "";

/**
 * Positive/negative admin decisions, each stamped with the generation it was
 * computed under. A stale generation invalidates the entry regardless of age.
 * @type {Map<string, { value: boolean, generation: number|null, ts: number }>}
 */
const _cache = new Map();
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 200;

function readCache(userId, generation) {
  const hit = _cache.get(userId);
  if (!hit) return undefined;
  if (Date.now() > hit.ts + CACHE_TTL_MS) {
    _cache.delete(userId);
    return undefined;
  }
  // INV-ENT-11: a generation change invalidates the decision immediately,
  // regardless of remaining TTL.
  if (hit.generation !== generation) {
    _cache.delete(userId);
    return undefined;
  }
  return hit.value;
}

function writeCache(userId, value, generation) {
  _cache.set(userId, { value, generation, ts: Date.now() });
  if (_cache.size > CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
}

/** Drop a cached admin decision on this instance. */
export function invalidateAdminAuthorityCache(userId) {
  if (userId) _cache.delete(userId);
  else _cache.clear();
}

/**
 * Authority derived from immutable, synchronously-available signals only.
 * No I/O — safe on hot paths.
 *
 * These two signals are intentionally NOT revocable at runtime: changing them
 * requires a deployment (env) or a service-key write plus token refresh
 * (app_metadata). Runtime-revocable authority lives in admin_principals.
 */
export function hasTrustedAdminClaim(user) {
  if (!user) return false;
  if (ADMIN_USER_ID && user.id === ADMIN_USER_ID) return true;
  if (user.app_metadata?.role === "admin") return true;
  return false;
}

/**
 * Authoritative admin check.
 * Fails CLOSED on every error path.
 *
 * @param {{ id?: string, app_metadata?: object }} user
 * @param {object} [adminClient] optional Supabase service client to reuse
 * @returns {Promise<boolean>}
 */
export async function isAdminPrincipal(user, adminClient = null) {
  if (!user?.id) return false;
  if (hasTrustedAdminClaim(user)) return true;

  const generation = await getEntitlementGeneration(user.id);

  // Only consult the cache when the generation is known. If it is not, we cannot
  // prove the entry is current, so we recompute rather than risk serving a
  // revoked grant.
  if (generation !== null) {
    const cached = readCache(user.id, generation);
    if (cached !== undefined) return cached;
  }

  try {
    const client = adminClient || getAdminClient();
    const { data, error } = await client
      .from("admin_principals")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      if (!isMissingSupabaseTable(error)) {
        console.error("[admin-authority] admin_principals lookup failed", error.message);
      }
      if (generation !== null) writeCache(user.id, false, generation);
      return false;
    }

    const result = Boolean(data);
    if (generation !== null) writeCache(user.id, result, generation);
    return result;
  } catch (err) {
    console.error("[admin-authority] admin_principals lookup threw", err?.message);
    return false;
  }
}

/**
 * Resolve admin authority for a bare user id.
 * @param {string} userId
 * @param {object} [adminClient]
 * @returns {Promise<boolean>}
 */
export async function isAdminUserId(userId, adminClient = null) {
  if (!userId) return false;
  if (ADMIN_USER_ID && userId === ADMIN_USER_ID) return true;
  return isAdminPrincipal({ id: userId }, adminClient);
}

/**
 * Grant admin authority. Server-only.
 * Bumps the generation so the new capability is visible immediately everywhere.
 */
export async function grantAdminPrincipal(userId, { grantedBy = null, note = null } = {}) {
  if (!userId) throw new Error("grantAdminPrincipal: userId required");
  const admin = getAdminClient();
  const { error } = await admin
    .from("admin_principals")
    .upsert({ user_id: userId, granted_by: grantedBy, note }, { onConflict: "user_id" });
  if (error) throw error;
  invalidateAdminAuthorityCache(userId);
  // INV-ENT-11 + INV-ENT-7: rights changed → generation and capability version move.
  await bumpEntitlementGeneration(userId);
}

/**
 * Revoke admin authority.
 * Bumps the generation so every instance drops its cached grant at once —
 * this is what closes the stale-admin window.
 */
export async function revokeAdminPrincipal(userId) {
  if (!userId) throw new Error("revokeAdminPrincipal: userId required");
  const admin = getAdminClient();
  const { error } = await admin.from("admin_principals").delete().eq("user_id", userId);
  if (error) throw error;
  invalidateAdminAuthorityCache(userId);
  await bumpEntitlementGeneration(userId);
  // Losing administrator authority is also a global MFA compromise boundary.
  const { error: mfaError } = await admin.rpc("bump_2mrrw_mfa_generation", {
    p_user_id: userId,
    p_reason: "admin_privilege_revoked",
  });
  if (mfaError) throw mfaError;
}
