/**
 * assurance — authentication assurance level, resolved from the identity
 * provider rather than from application state.
 *
 * INV-AUTH-1  MFA assurance is enforced by the session authority / identity
 *             provider, never by application UI state.
 * INV-AUTH-2  Direct password authentication cannot bypass required MFA
 *             assurance.
 *
 * ── The bypass this closes ──────────────────────────────────────────────────
 *
 * login-step1/step2 verified a password, parked the Supabase tokens in a
 * `_2fa_pending` cookie, and released them after an emailed code. That gated the
 * application's own login screen and nothing else — Supabase's password grant
 * stays reachable with the public anon key:
 *
 *     POST /auth/v1/token?grant_type=password  { email, password }
 *       → a full, working session. login-step1/step2 never consulted.
 *
 * This was confirmed empirically, not inferred: the E0 adversarial check
 * authenticated exactly that way and received a usable session.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 *
 * Supabase issues an Authenticator Assurance Level with every session:
 *
 *   aal1  a single factor was presented (password)
 *   aal2  a second factor was also verified
 *
 * A session obtained through the raw password grant is aal1 and CANNOT be
 * upgraded without completing a real MFA challenge against the provider. So the
 * server stops asking "did the user pass our OTP screen?" — which a bypasser
 * never touches — and asks "what assurance does this session carry?", which the
 * bypasser cannot forge.
 *
 * ── Enrolment nuance (why this is a policy, not a boolean) ──────────────────
 *
 * `getAuthenticatorAssuranceLevel()` returns { currentLevel, nextLevel }:
 *
 *   nextLevel === 'aal2' && currentLevel === 'aal1'   factors ENROLLED, not yet
 *                                                     verified this session → DENY
 *   currentLevel === 'aal2'                           satisfied → ALLOW
 *   nextLevel === 'aal1'                              NO factors enrolled at all
 *
 * The last case is the one that needs a decision rather than a reflex. Requiring
 * aal2 from an administrator who has never enrolled a factor locks them out of
 * the very console they would use to enrol. So enforcement is staged by
 * ADMIN_MFA_POLICY:
 *
 *   'off'      (default) assurance is reported but never blocks. Ship-safe.
 *   'enrolled' block only when factors exist but were not verified. Closes the
 *              real bypass without locking anyone out. Recommended first step.
 *   'required' additionally block admins with no factors enrolled. The end state,
 *              set once administrators have enrolled.
 */

import { createClient } from "@/lib/supabase/server";

export const AssuranceLevel = Object.freeze({
  AAL1: "aal1",
  AAL2: "aal2",
});

export const AdminMfaPolicy = Object.freeze({
  OFF:      "off",
  ENROLLED: "enrolled",
  REQUIRED: "required",
});

export function adminMfaPolicy() {
  const raw = String(process.env.ADMIN_MFA_POLICY || "").trim().toLowerCase();
  return Object.values(AdminMfaPolicy).includes(raw) ? raw : AdminMfaPolicy.OFF;
}

/**
 * Read the current session's assurance directly from the provider.
 *
 * Fails CLOSED in the sense that matters: an unreadable assurance is reported as
 * `unknown`, and requireMfaAssurance() treats unknown as unsatisfied whenever a
 * policy is active.
 *
 * @returns {Promise<{ currentLevel: string|null, nextLevel: string|null,
 *                     enrolled: boolean, satisfied: boolean, unknown: boolean }>}
 */
export async function getSessionAssurance() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) {
      return { currentLevel: null, nextLevel: null, enrolled: false, satisfied: false, unknown: true };
    }
    const currentLevel = data.currentLevel ?? null;
    const nextLevel = data.nextLevel ?? null;
    return {
      currentLevel,
      nextLevel,
      // nextLevel climbs to aal2 only when at least one factor is enrolled.
      enrolled: nextLevel === AssuranceLevel.AAL2,
      satisfied: currentLevel === AssuranceLevel.AAL2,
      unknown: false,
    };
  } catch {
    return { currentLevel: null, nextLevel: null, enrolled: false, satisfied: false, unknown: true };
  }
}

/**
 * Gate an operation on MFA assurance, per the active policy.
 *
 * @param {{ policy?: string }} [opts] override for tests
 * @returns {Promise<{ ok: boolean, reason?: string, assurance: object, policy: string }>}
 */
export async function requireMfaAssurance({ policy = adminMfaPolicy() } = {}) {
  const assurance = await getSessionAssurance();

  if (policy === AdminMfaPolicy.OFF) {
    return { ok: true, assurance, policy, reason: "policy_off" };
  }

  if (assurance.satisfied) {
    return { ok: true, assurance, policy };
  }

  // Cannot prove assurance → treat as unsatisfied while a policy is active.
  if (assurance.unknown) {
    return { ok: false, reason: "assurance_unknown", assurance, policy };
  }

  // Factors enrolled but this session never verified one. This is exactly the
  // raw-password-grant bypass, and it is denied under both active policies.
  if (assurance.enrolled) {
    return { ok: false, reason: "mfa_required", assurance, policy };
  }

  // No factors enrolled at all.
  if (policy === AdminMfaPolicy.REQUIRED) {
    return { ok: false, reason: "mfa_enrolment_required", assurance, policy };
  }

  return { ok: true, assurance, policy, reason: "not_enrolled_policy_enrolled" };
}
