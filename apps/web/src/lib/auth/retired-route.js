/**
 * retired-route — fail-closed retirement for endpoints with no known caller.
 *
 * INV-ADMIN-3  Static shared bearer secrets are not a parallel canonical admin
 *              authority.
 *
 * ── Why these are retired rather than re-gated ──────────────────────────────
 *
 * A3 of the E1 brief asked, for save-purchase / register-user / get-purchases:
 * who is supposed to call this, does it need ADMIN authority, and can it be
 * removed? A repository-wide search found **no caller** — no component, no hook,
 * no page, no script. They were reachable only by presenting ADMIN_SEED_SECRET.
 *
 * They are also the highest-consequence of the eleven: they write purchase state,
 * create users, and read the purchase ledger. Re-gating them as "admin" would
 * have granted a live, powerful surface a new lease purely because it previously
 * used the seed secret — which the brief explicitly warned against.
 *
 * ── Why a flag instead of deletion ──────────────────────────────────────────
 *
 * Absence of an in-repo caller is not proof of absence of an external one: a
 * Postman collection, a one-off operator script, or a scheduled task outside the
 * repository could still invoke them. Deleting outright would turn an unknown
 * into an outage. So they return 410 Gone by default and log loudly, and a single
 * environment variable restores one of them if something real breaks.
 *
 * Default is off. Nothing has to be configured for the secure state.
 *
 * If nothing has invoked these after a full operating cycle, delete the files.
 */

import { NextResponse } from "next/server";

/**
 * @param {string} routeName  for the log line and the response body
 * @returns {NextResponse|null} a 410 when retired, or null to continue
 */
export function retiredRouteGuard(routeName) {
  const enabled = process.env.LEGACY_SEED_ROUTES_ENABLED === "1";
  if (enabled) {
    console.warn(
      `[retired-route] ${routeName} was invoked while LEGACY_SEED_ROUTES_ENABLED=1. ` +
      "This endpoint has no caller in the repository and is scheduled for deletion. " +
      "Identify the caller and migrate it to a scoped capability."
    );
    return null;
  }
  console.warn(`[retired-route] blocked call to retired endpoint ${routeName}`);
  return NextResponse.json(
    {
      error: "This endpoint has been retired.",
      code: "ROUTE_RETIRED",
      route: routeName,
      detail:
        "It previously authorised via a shared admin secret and has no known caller. " +
        "If you need it, set LEGACY_SEED_ROUTES_ENABLED=1 and report the caller so it " +
        "can be migrated to a scoped service capability.",
    },
    { status: 410 }
  );
}
