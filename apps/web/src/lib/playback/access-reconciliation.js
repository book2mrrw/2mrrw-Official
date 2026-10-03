import { resolveTrackAccess, libraryStreamRedirectSrc } from "@/lib/music-access";

/**
 * One rule for "what may this track play right now", applied by the engine.
 *
 * Surfaces stamp `metadata.access` (and pick `src`) when they BUILD a track. A
 * track built before the session hydrated, or by a surface that forgot to pass
 * the user id, carries a preview stamp and an empty or preview `src` — and the
 * engine used to trust that stamp, so an owner heard a 15-second preview. The
 * engine now re-resolves access against the live entitlement state:
 *
 *   - on every play / queue load (upgrade-only: a stale preview stamp is lifted,
 *     a full stamp is never taken away mid-intent), and
 *   - whenever entitlements change (both directions — Effect 5).
 */

/** True once the entitlement state describes a real session (not the pre-hydration empty state). */
export function isEntitlementStateHydrated(accountState) {
  return Boolean(
    accountState?.user?.id ||
      accountState?.isAdmin === true ||
      accountState?.permissions?.admin === true
  );
}

function subTrackSlugOf(track) {
  const raw = track?.metadata?.trackSlug || null;
  return raw && raw !== track.slug ? raw : null;
}

/**
 * Re-resolve `track` against `accountState`. Returns the SAME object when
 * nothing changes, so callers can detect change by identity.
 *
 * @param {object} track playback track (slug, src, metadata.access, metadata.trackSlug)
 * @param {object} accountState live entitlement account state
 * @param {{ allowDowngrade?: boolean }} [options]
 */
export function reconcileTrackAccess(track, accountState, { allowDowngrade = true } = {}) {
  if (!track || typeof track !== "object" || !track.slug) return track;

  const fresh = resolveTrackAccess(track, accountState);
  const prev = track.metadata?.access;
  const missingEntitledSrc = Boolean(fresh.canStream && !track.src);
  if (
    prev?.canStream === fresh.canStream &&
    prev?.previewOnly === fresh.previewOnly &&
    !missingEntitledSrc
  ) {
    return track;
  }

  const justGainedStream = Boolean(fresh.canStream && (!prev?.canStream || prev?.previewOnly || !track.src));
  // Symmetric downgrade: a lapsed subscription / revoked entitlement flips
  // canStream true → false. Fall back to whatever preview URL this track
  // carried before it was ever upgraded.
  const justLostStream = Boolean(prev?.canStream && !fresh.canStream);
  if (justLostStream && !allowDowngrade) return track;
  if (!justGainedStream && !justLostStream && !allowDowngrade) return track;

  const src = justGainedStream
    ? libraryStreamRedirectSrc(track.slug, { trackSlug: subTrackSlugOf(track) })
    : justLostStream
      ? (track.metadata?.previewSrc || track.preview || track.preview_path || track.src)
      : track.src;

  return {
    ...track,
    src,
    metadata: {
      ...(track.metadata || {}),
      access: { ...(prev || {}), ...fresh },
    },
  };
}

/**
 * Play-time form: only lifts stale preview stamps, and only on a hydrated session.
 * A stamp that carries a release-lifecycle verdict of "not playable in full yet"
 * (e.g. an owned preorder before release day) is deliberate, not stale — leave it.
 */
export function upgradeTrackAccessForPlay(track, accountState) {
  if (!isEntitlementStateHydrated(accountState)) return track;
  if (track?.metadata?.access?.lifecycle?.canPlayFull === false) return track;
  return reconcileTrackAccess(track, accountState, { allowDowngrade: false });
}
