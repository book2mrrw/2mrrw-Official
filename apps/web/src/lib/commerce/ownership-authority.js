/**
 * ownership-authority — explicit source-of-truth state for product ownership.
 *
 * INV-ENT-10  The ownership source of truth is an explicit, auditable state.
 *             Table existence never implies migration completeness.
 *
 * ── The defect this replaces (ENT-06) ───────────────────────────────────────
 *
 *   getOwnedSlugs() previously did:
 *
 *       const fromEntitlements = await slugsFromEntitlements(admin, userId);
 *       if (fromEntitlements !== null) return new Set(fromEntitlements);
 *       // library_items fallback — unreachable whenever the table merely EXISTS
 *
 *   slugsFromEntitlements() returns null ONLY when the table is missing (42P01).
 *   Once the table exists, an empty result was treated as authoritative "owns
 *   nothing" — even for a user whose rows were never backfilled. Ambiguity
 *   between "no entitlements" and "not migrated yet" silently became a denial.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 *
 *   LEGACY_LIBRARY          library_items is authoritative. entitlements ignored.
 *                           Use before any backfill has run.
 *
 *   DUAL_VERIFY (default)   Union of both sources. Divergence is recorded so
 *                           entitlements-parity can be driven to zero. A user is
 *                           never denied because one side lags. Safe at all times.
 *
 *   ENTITLEMENTS_CANONICAL  entitlements is authoritative. library_items ignored.
 *                           Only after parity reports libraryOnly = 0.
 *
 * Advancing the state is a deliberate operator action, never inferred.
 *
 * ── Resolution order ────────────────────────────────────────────────────────
 *   1. OWNERSHIP_AUTHORITY_STATE env var (deployment override, wins)
 *   2. public.ownership_authority_state table (single row)
 *   3. DUAL_VERIFY (safe default — never under-reports)
 */

export const OwnershipAuthorityState = Object.freeze({
  LEGACY_LIBRARY:         "LEGACY_LIBRARY",
  DUAL_VERIFY:            "DUAL_VERIFY",
  ENTITLEMENTS_CANONICAL: "ENTITLEMENTS_CANONICAL",
});

const VALID = new Set(Object.values(OwnershipAuthorityState));
const DEFAULT_STATE = OwnershipAuthorityState.DUAL_VERIFY;

// ── NO LOCAL STATE CACHE — deliberate (INV-ENT-13) ──────────────────────────
//
// An earlier revision cached the authority state in-process for 60 s. During a
// cutover that produced an uncontrolled mixed-mode period: for up to a minute
// some instances resolved ownership under LEGACY_LIBRARY while others already
// used ENTITLEMENTS_CANONICAL, so the same user could be told they owned a track
// by one request and not by the next. A cutover must be deterministic.
//
// The state is now read on every resolution. This is NOT a hot path:
// getOwnedSlugs already performs two database queries, and userCanStreamProduct
// reaches it only on a cache miss. One additional read is immaterial there, and
// it buys instant, uniform propagation across every instance.

/**
 * Current ownership authority state, plus the parity attestation that governs
 * whether ENTITLEMENTS_CANONICAL may actually be honoured.
 *
 * Never throws — an unreadable state degrades to DUAL_VERIFY, which by
 * definition cannot under-report ownership.
 *
 * @param {object} admin Supabase service client
 * @returns {Promise<{ state: string, parityVerifiedAt: string|null,
 *                     parityLibraryOnly: number|null, source: string }>}
 */
export async function getOwnershipAuthorityState(admin) {
  const envState = String(process.env.OWNERSHIP_AUTHORITY_STATE || "").trim().toUpperCase();

  let state = null;
  let parityVerifiedAt = null;
  let parityLibraryOnly = null;
  let source = "default";

  if (VALID.has(envState)) {
    state = envState;
    source = "env";
  }

  // The table is consulted even when an env override is present, because the
  // parity attestation lives there and gates CANONICAL regardless of how the
  // state was chosen.
  try {
    const { data, error } = await admin
      .from("ownership_authority_state")
      .select("state, parity_verified_at, parity_library_only_count")
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      parityVerifiedAt = data.parity_verified_at ?? null;
      parityLibraryOnly =
        data.parity_library_only_count === null || data.parity_library_only_count === undefined
          ? null
          : Number(data.parity_library_only_count);
      if (!state && VALID.has(data.state)) {
        state = data.state;
        source = "table";
      }
    }
  } catch {
    /* fall through to the default */
  }

  if (!state) state = DEFAULT_STATE;

  // ── Parity gate (INV-ENT-14) ──────────────────────────────────────────────
  // ENTITLEMENTS_CANONICAL discards library_items entirely. Honouring it without
  // proof of parity would silently strip ownership from every user whose rows
  // were never backfilled — the exact ENT-06 failure, re-entered through
  // configuration instead of inference. Refuse until parity is attested at zero.
  if (state === OwnershipAuthorityState.ENTITLEMENTS_CANONICAL) {
    const attested = parityVerifiedAt !== null && parityLibraryOnly === 0;
    if (!attested) {
      console.error(
        "[ownership-authority] ENTITLEMENTS_CANONICAL requested but parity is not " +
        "attested at zero — refusing and falling back to DUAL_VERIFY",
        { parityVerifiedAt, parityLibraryOnly, source }
      );
      return {
        state: OwnershipAuthorityState.DUAL_VERIFY,
        parityVerifiedAt,
        parityLibraryOnly,
        source: `${source}:parity_refused`,
      };
    }
  }

  return { state, parityVerifiedAt, parityLibraryOnly, source };
}

/**
 * Resolve owned slugs under the active authority state.
 *
 * @param {object} admin
 * @param {string} userId
 * @param {{ fromEntitlements: string[]|null, fromLibrary: string[] }} sources
 *   fromEntitlements === null means the entitlements table is absent (42P01),
 *   which is distinct from an empty array.
 * @returns {Promise<{ slugs: Set<string>, state: string, divergence: object|null }>}
 */
export async function resolveOwnedSlugs(admin, userId, { fromEntitlements, fromLibrary }) {
  const { state } = await getOwnershipAuthorityState(admin);
  const ent = fromEntitlements === null ? null : new Set(fromEntitlements);
  const lib = new Set(fromLibrary || []);

  // A missing table can never be canonical, whatever the configured state says.
  if (ent === null) {
    return { slugs: lib, state: OwnershipAuthorityState.LEGACY_LIBRARY, divergence: null };
  }

  if (state === OwnershipAuthorityState.LEGACY_LIBRARY) {
    return { slugs: lib, state, divergence: null };
  }

  if (state === OwnershipAuthorityState.ENTITLEMENTS_CANONICAL) {
    return { slugs: ent, state, divergence: null };
  }

  // DUAL_VERIFY — union, and record which side is behind.
  const libraryOnly = [...lib].filter((s) => !ent.has(s));
  const entitlementsOnly = [...ent].filter((s) => !lib.has(s));
  const divergence =
    libraryOnly.length || entitlementsOnly.length
      ? { userId, libraryOnly, entitlementsOnly }
      : null;

  if (divergence && process.env.OWNERSHIP_DIVERGENCE_LOG === "1") {
    console.warn("[ownership-authority] source divergence", {
      userId,
      libraryOnly: libraryOnly.length,
      entitlementsOnly: entitlementsOnly.length,
    });
  }

  return { slugs: new Set([...lib, ...ent]), state, divergence };
}
