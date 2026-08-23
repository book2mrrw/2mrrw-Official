/**
 * CapabilityDocument — the normalized, canonical statement of what a principal
 * may currently do.
 *
 * INV-ENT-7  capabilityVersion changes when — and ONLY when — effective
 *            authorization changes. A JWT refresh, a session rotation, a profile
 *            edit, or a membership row whose updated_at moved but whose rights
 *            did not, must all produce NO version change.
 *
 * ── Why a fingerprint and not a timestamp ───────────────────────────────────
 *
 * Version-by-timestamp or version-by-write-count breaks the invariant: Stripe
 * re-sends subscription.updated on every billing cycle, and each one rewrites
 * the membership row without changing a single right. Downstream consumers that
 * treat "version moved" as "re-evaluate everything" would churn continuously.
 *
 * The fingerprint is a hash of the NORMALIZED RIGHTS ONLY. Two computations with
 * identical rights produce byte-identical documents and therefore the same
 * fingerprint, no matter how much unrelated state moved in between.
 *
 * ── Normalization rules (locked) ────────────────────────────────────────────
 *
 *   INCLUDED — things that change what the user may do
 *     isAdmin, isSubscriber, isCollector, vaultTier, playbackPolicy,
 *     ownedSlugs (sorted, de-duplicated)
 *
 *   EXCLUDED — things that move without changing rights
 *     any timestamp (updated_at, current_period_end, granted_at, syncedAt)
 *     session/JWT identifiers, expiry, refresh counters
 *     stripe_customer_id, stripe_subscription_id
 *     display fields: name, avatar, email, phone
 *     membership.status string when it maps to the same boolean right
 *     library item ordering, cover art, titles, prices
 *     entitlement row ids and source labels
 *
 * Adding a field to the document is a deliberate act: it changes what counts as
 * a capability change for every consumer. Keep the surface minimal.
 *
 * ── Version semantics ───────────────────────────────────────────────────────
 *
 *   capabilityFingerprint  content-addressed; deterministic; no storage needed
 *   capabilityVersion      monotonic counter, incremented only when the stored
 *                          fingerprint for that user differs from the computed one
 *
 * The generation counter from entitlement-cache is the invalidation substrate;
 * capabilityVersion is the *observable* semantic on top of it. A generation bump
 * forces recomputation, but only an actual rights delta moves the version.
 */

import crypto from "crypto";

export const CAPABILITY_DOCUMENT_SCHEMA = 1;

/**
 * Build the normalized capability document.
 *
 * Deterministic: identical rights always yield an identical object with keys in
 * a fixed order and arrays sorted.
 *
 * @param {object} input
 * @param {boolean} [input.isAdmin]
 * @param {boolean} [input.isSubscriber]
 * @param {boolean} [input.isCollector]
 * @param {string}  [input.vaultTier]        "public" | "inner_circle" | "vault_pass"
 * @param {string}  [input.playbackPolicy]   PLAYBACK_POLICY constant
 * @param {Iterable<string>} [input.ownedSlugs]
 * @returns {{ schema: number, isAdmin: boolean, isSubscriber: boolean,
 *             isCollector: boolean, vaultTier: string, playbackPolicy: string,
 *             ownedSlugs: string[] }}
 */
export function buildCapabilityDocument({
  isAdmin = false,
  isSubscriber = false,
  isCollector = false,
  vaultTier = "public",
  playbackPolicy = "PREVIEW_ONLY",
  ownedSlugs = [],
} = {}) {
  const slugs = [...new Set(
    Array.from(ownedSlugs || [])
      .filter((s) => typeof s === "string" && s.length > 0)
  )].sort();

  // Key order is fixed by literal declaration order and consumed by
  // canonicalize() below, which does not rely on it — but keeping it stable
  // makes diffs readable.
  return Object.freeze({
    schema: CAPABILITY_DOCUMENT_SCHEMA,
    isAdmin: Boolean(isAdmin),
    isSubscriber: Boolean(isSubscriber),
    isCollector: Boolean(isCollector),
    vaultTier: String(vaultTier || "public"),
    playbackPolicy: String(playbackPolicy || "PREVIEW_ONLY"),
    ownedSlugs: slugs,
  });
}

/**
 * Deterministic serialization. Object keys are emitted in sorted order so the
 * encoding does not depend on construction order or JS engine behaviour.
 */
export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

/**
 * Content-addressed fingerprint of a capability document.
 * @param {object} doc
 * @returns {string} 64-char hex sha256
 */
export function capabilityFingerprint(doc) {
  return crypto.createHash("sha256").update(canonicalize(doc)).digest("hex");
}

/**
 * True when two documents grant exactly the same rights.
 * @param {object} a
 * @param {object} b
 */
export function sameCapabilities(a, b) {
  return capabilityFingerprint(a) === capabilityFingerprint(b);
}
