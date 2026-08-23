/**
 * principal — the platform's identity assurance vocabulary.
 *
 * INV-ID-1  Knowing profile attributes never authenticates an existing principal.
 * INV-ID-2  Session issuance requires cryptographic or possession proof.
 * INV-ID-3  Identity LOOKUP and identity PROOF are separate operations.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Security state was previously inferred from how a row happened to be created:
 * an account made through guest checkout was "a guest", and being able to
 * restate the email and phone used at checkout was treated as being that person.
 * Those are different claims. One is a lookup key; the other is authentication.
 *
 * These levels name the distinction so a route can state the assurance it needs
 * instead of guessing from row provenance.
 */

export const PrincipalKind = Object.freeze({
  /** Anonymous. No identity asserted. */
  ANONYMOUS:            "ANONYMOUS",
  /** Identity ASSERTED (email/phone supplied) but never proven. Cannot hold a session. */
  GUEST_UNVERIFIED:     "GUEST_UNVERIFIED",
  /** Guest identity proven by possession (OTP / magic link / scoped claim token). */
  GUEST_VERIFIED:       "GUEST_VERIFIED",
  /** Registered account, email not confirmed by a real challenge. */
  REGISTERED_UNVERIFIED:"REGISTERED_UNVERIFIED",
  /** Registered and provider-verified. */
  REGISTERED_VERIFIED:  "REGISTERED_VERIFIED",
  /** Registered, verified, and holding provider AAL2 for this session. */
  MFA_VERIFIED:         "MFA_VERIFIED",
  SUSPENDED:            "SUSPENDED",
  DELETED:              "DELETED",
});

/** Ordering for "at least this assured" comparisons. */
const RANK = {
  [PrincipalKind.ANONYMOUS]:             0,
  [PrincipalKind.GUEST_UNVERIFIED]:      1,
  [PrincipalKind.GUEST_VERIFIED]:        2,
  [PrincipalKind.REGISTERED_UNVERIFIED]: 3,
  [PrincipalKind.REGISTERED_VERIFIED]:   4,
  [PrincipalKind.MFA_VERIFIED]:          5,
  [PrincipalKind.SUSPENDED]:            -1,
  [PrincipalKind.DELETED]:              -1,
};

/**
 * Classify a resolved session user plus its provider assurance.
 *
 * @param {object|null} user       from getFanSessionUser() / getGuestUser()
 * @param {object|null} assurance  from getSessionAssurance()
 */
export function classifyPrincipal(user, assurance = null) {
  if (!user) return PrincipalKind.ANONYMOUS;
  if (user.isGuest === true) {
    // A guest session cookie is only ever minted after possession proof, or for
    // a newly created identity that owns nothing. Both are GUEST_VERIFIED for
    // authorisation purposes; neither is ever administrative (INV-ADMIN-1).
    return PrincipalKind.GUEST_VERIFIED;
  }
  if (assurance?.satisfied) return PrincipalKind.MFA_VERIFIED;
  return PrincipalKind.REGISTERED_VERIFIED;
}

/** True when `kind` is at least as assured as `minimum`. */
export function meetsAssurance(kind, minimum) {
  const a = RANK[kind] ?? -1;
  const b = RANK[minimum] ?? 0;
  return a >= 0 && a >= b;
}
