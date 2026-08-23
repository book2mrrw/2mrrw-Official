/**
 * Synchronous admin predicate.
 *
 * INV-ENT-1  User-controlled profile/auth metadata can never grant admin authority.
 * INV-ENT-2  Admin capability originates only from server-controlled state.
 * INV-ENT-9  Admin authority binds only to immutable principal identity.
 *
 * Called synchronously from ~40 sites (every /api/admin/* route, the stream and
 * HLS entitlement gates, account state), so it cannot perform I/O. It accepts
 * only signals already trustworthy in memory:
 *
 *   user.isAdmin === true   resolved by getFanSessionUser() from admin_principals,
 *                           generation-validated. Never hydrated from client data.
 *   ADMIN_USER_ID env       deployment-pinned immutable Supabase user UUID
 *   app_metadata.role       service-key-only JWT claim
 *
 * REMOVED — ENT-01 / ENT-02:
 *   user.role === "admin"   `role` was fed from profiles.role (client-writable via
 *                           the profiles_update_own RLS policy) and from
 *                           user_metadata.role (writable via auth.updateUser()).
 *
 * REMOVED — E0-B / INV-ENT-9:
 *   ADMIN_EMAIL match       Email is a mutable, re-assignable attribute. Binding
 *                           administrative authority to it means authority follows
 *                           an address rather than a principal: changing the email
 *                           on an account moves admin with it, and re-using a
 *                           freed address confers it. Authority now binds only to
 *                           an immutable user id.
 *
 *                           To seed the first admin, either set ADMIN_USER_ID or
 *                           call public.bootstrap_admin_by_email() once from a
 *                           privileged SQL session (migration 20260822000010).
 *
 * For a bare user id with no session object, use isAdminUserId() from
 * @/lib/auth/admin-authority.
 */

export const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "";

/**
 * Retained ONLY for non-authority uses: cosmetic admin-nav hints and log
 * annotation. Never branch an access decision on this value.
 * @deprecated for any authorization purpose — INV-ENT-9.
 */
export const ADMIN_EMAIL_DISPLAY_HINT = (process.env.ADMIN_EMAIL ?? "").toLowerCase();

export function isAdminUser(user) {
  if (!user) return false;

  // ── INV-ENT-15: a guest identity can NEVER be administrative ──────────────
  //
  // getGuestUser() resolves whatever user id a signed guest_session cookie
  // names — it is not restricted to accounts created as guests. Without this
  // guard, a cookie carrying ADMIN_USER_ID satisfies the id branch below and
  // yields full admin.
  //
  // Four routes resolve identity as `getFanSessionUser() ?? getGuestUser()` and
  // then call isAdminUser: library/stream, library/hls, vault/video/manifest and
  // vault/video/captions. All four are closed by this single clause.
  //
  // Safe by construction: getFanSessionUser() sets isGuest:false, so a genuine
  // administrator is unaffected. Admin authority requires a real session.
  if (user.isGuest === true) return false;

  // Resolved server-side from admin_principals, validated against the user's
  // entitlement generation. Trusted because the session user object is built on
  // the server and never hydrated from client-supplied data.
  if (user.isAdmin === true) return true;

  // Deployment-pinned immutable identity.
  if (ADMIN_USER_ID && user.id === ADMIN_USER_ID) return true;

  // JWT app_metadata claim — writable only with the service key.
  if (user.app_metadata?.role === "admin") return true;

  return false;
}
