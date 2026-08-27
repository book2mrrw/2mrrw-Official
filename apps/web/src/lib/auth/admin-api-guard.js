/**
 * admin-api-guard — the single authorisation boundary for privileged routes.
 *
 * INV-ADMIN-1  Guest principals can never receive administrative authority.
 * INV-ADMIN-2  Administrative authority derives from immutable authenticated
 *              principal identity.
 * INV-ADMIN-3  Static shared bearer secrets are not a parallel canonical admin
 *              authority.
 * INV-SEC-2    Independent trust domains cannot fall back to one another's secret.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * Eleven routes accepted `x-seed-secret: <ADMIN_SEED_SECRET>` as full admin
 * authority. That same string was also the fallback signing key for guest
 * session cookies, gift reminder tokens and collector-card IP hashing, and one
 * admin page collected it with window.prompt() and sent it from the browser.
 * A single static value governed four trust domains and routinely transited
 * client JavaScript.
 *
 * ── The model: two authorities, no universal bearer ─────────────────────────
 *
 *   requireAdminActor()          A HUMAN administrator. Resolves the real
 *                                session, rejects guests, checks
 *                                admin_principals, and applies the MFA
 *                                assurance policy. Revocable, attributable.
 *
 *   requireServiceCapability(req, cap)
 *                                A MACHINE. Constant-time comparison against a
 *                                credential scoped to ONE named capability.
 *                                There is deliberately no "admin service
 *                                secret" that unlocks everything.
 *
 * Each capability reads its own environment variable. A credential for catalog
 * sync cannot ingest R2, and neither can create gifts. Compromise of one
 * integration does not become platform compromise, and rotating one does not
 * disturb the others (INV-SEC-3).
 *
 * ADMIN_SEED_SECRET is not read anywhere in this module.
 */

import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { verifyMfaAuthority } from "@/lib/auth/mfa-authority";
import { classifyAdminAuthorityDenial } from "@/lib/auth/admin-authority-diagnostics";
import { emitServerEvent } from "@/lib/observability/server-events";
import crypto from "crypto";

/**
 * Named service capabilities and the environment variable backing each.
 * Adding a capability is a deliberate act: it creates a new credential, not a
 * new use of an existing one.
 */
export const ServiceCapability = Object.freeze({
  CATALOG_SYNC:      "SVC_CATALOG_SYNC_SECRET",
  CATALOG_INGEST:    "SVC_CATALOG_INGEST_SECRET",
  CATALOG_REVALIDATE:"SVC_CATALOG_REVALIDATE_SECRET",
  DROP_NOTIFICATION: "SVC_DROP_NOTIFICATION_SECRET",
  DIAGNOSTICS_READ:  "SVC_DIAGNOSTICS_SECRET",
  PRODUCT_SEED:      "SVC_PRODUCT_SEED_SECRET",
  FULFILL_RECOVERY:  "SVC_FULFILL_RECOVERY_SECRET",
  HLS_COMPLETE:      "HLS_WORKER_API_TOKEN",
  R2_CORS_CONFIGURE: "SVC_R2_CORS_SECRET",
  PLAYBACK_BACKFILL: "SVC_PLAYBACK_BACKFILL_SECRET",
});

/** Constant-time compare that tolerates a length mismatch without throwing. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

function presentedCredential(req) {
  return (
    req?.headers?.get?.("x-service-credential") ||
    req?.headers?.get?.("authorization")?.replace(/^Bearer\s+/i, "") ||
    ""
  );
}

/**
 * Machine caller holding the credential for ONE named capability.
 *
 * @param {Request} req
 * @param {string} capability a ServiceCapability value (the env var name)
 * @returns {{ ok: boolean, via?: string, capability?: string, reason?: string }}
 */
export function requireServiceCapability(req, capability) {
  if (!capability || !Object.values(ServiceCapability).includes(capability)) {
    return { ok: false, reason: "unknown_capability" };
  }
  const expected = process.env[capability] || "";
  if (!expected) {
    // Fail closed: an unconfigured capability grants nothing. It is never
    // satisfied by "some other secret that happens to be set".
    return { ok: false, reason: "capability_not_configured" };
  }
  const presented = presentedCredential(req);
  if (!presented) return { ok: false, reason: "no_credential" };
  if (!safeEqual(presented, expected)) return { ok: false, reason: "bad_credential" };
  return { ok: true, via: "service_capability", capability };
}

/**
 * Human administrator: real session, not a guest, in admin_principals, and
 * meeting the MFA assurance policy.
 *
 * @returns {Promise<{ ok:boolean, user?:object, mfa?:object, reason?:string }>}
 */
export async function requireAdminActor({ recentSeconds = null, logDenial = true } = {}) {
  const user = await getFanSessionUser();
  if (!user) return denyAdminAuthority("no_session", { logDenial });

  // INV-ADMIN-1 — belt and braces. isAdminUser() also rejects guests, but the
  // admin boundary states it explicitly rather than inheriting it.
  if (user.isGuest === true) return denyAdminAuthority("guest_principal", { user, logDenial });

  if (!isAdminUser(user)) return denyAdminAuthority("not_admin", { user, logDenial });

  // INV-AUTH-1 / INV-AUTH-2 — assurance comes from the provider, so a session
  // obtained through the raw password grant cannot satisfy it.
  const mfa = await verifyMfaAuthority({ userId: user.id, recentSeconds });
  if (!mfa.ok) return denyAdminAuthority(mfa.reason, { user, mfa, logDenial });

  return { ok: true, user, mfa, via: "admin_session" };
}

function denyAdminAuthority(reason, { user = null, mfa = null, logDenial = true } = {}) {
  const diagnostic = classifyAdminAuthorityDenial(reason);
  if (logDenial) {
    emitServerEvent(diagnostic.level, "admin_authority_denied", {
      code: diagnostic.code,
      actorId: user?.id || null,
      configurationState:
        diagnostic.code === "ADMIN_AUTH_MFA_CONFIGURATION_ERROR"
          ? mfa?.configurationState || null
          : undefined,
    });
  }
  return { ok: false, reason, ...(user ? { user } : {}), ...(mfa ? { mfa } : {}) };
}

/**
 * Compatibility adapter for route handlers that historically expected a user
 * object or null. It preserves that narrow contract while routing every human
 * admin decision through the canonical identity + MFA boundary above.
 *
 * New routes should prefer requireAdminActor() so they can retain the denial
 * reason and assurance details.
 */
export async function getAdminSessionUser(options) {
  const gate = await requireAdminActor(options);
  return gate.ok ? gate.user : null;
}

/**
 * Accept an administrator session, or the credential for one named capability.
 *
 * There is no variant that accepts "any service secret" — the capability must
 * be named at the call site, so a route declares exactly which machine identity
 * may invoke it.
 *
 * @param {Request} req
 * @param {string} capability a ServiceCapability value
 */
export async function requireAdminOrCapability(req, capability) {
  // A legitimate machine caller has no human session by design. Defer the
  // human-denial event until both authority paths fail so service traffic does
  // not create false ADMIN_AUTH_NO_SESSION incidents.
  const actor = await requireAdminActor({ logDenial: false });
  if (actor.ok) return actor;
  const service = requireServiceCapability(req, capability);
  if (service.ok) return service;
  denyAdminAuthority(actor.reason, { user: actor.user, mfa: actor.mfa });
  // Report the more actionable reason.
  return {
    ok: false,
    reason: actor.reason === "not_admin" || actor.reason === "guest_principal"
      ? actor.reason
      : service.reason,
    adminReason: actor.reason,
    serviceReason: service.reason,
  };
}
