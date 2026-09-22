/** Facts come from existing server entitlement owners, never request payloads. */
export function canAccessBroadcast(session, facts, now = Date.now()) {
  if (!session || !facts?.signedIn) return false;
  if (facts.admin) return true;
  if (session.state === "DRAFT") return false;
  switch (session.accessPolicy) {
    case "PUBLIC": return true;
    case "ENTRY": return facts.liveEntry === true;
    case "PURCHASER": return facts.purchaser === true;
    case "SUBSCRIBER": return facts.subscriber === true;
    case "COLLECTOR_CARD_OWNER": return facts.collector === true;
    case "INVITE_ONLY":
    case "PRIVATE_PRESS_INDUSTRY": {
      const grant = facts.grant;
      return Boolean(grant && !grant.revokedAt && Number.isFinite(grant.expiresAt) && grant.expiresAt > now
        && grant.sessionId === session.id
        && grant.kind === (session.accessPolicy === "INVITE_ONLY" ? "invite" : "press"));
    }
    default: return false;
  }
}

export function broadcastMediaItem(session, itemId, { admin = false } = {}) {
  if (!session || session.state === "ENDED") return null;
  const item = session.items.find((entry) => entry.id === itemId);
  if (!item || item.excluded) return null;
  if (admin) return item;
  if (session.state === "DRAFT" || item.completed) return null;
  const ordered = session.items.filter((entry) => !entry.excluded && !entry.completed).sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((entry) => entry.id === session.currentItemId);
  const allowed = index < 0 ? ordered.slice(0, 2) : ordered.slice(index, index + 2);
  return allowed.some((entry) => entry.id === itemId) ? item : null;
}

export function listenerSnapshot(session) {
  // Explicit DTO: no canonical IDs, storage keys, invitation data or signed URLs.
  return {
    id: session.id, type: session.type, title: session.presentation?.showTitle ? session.title : "2MRRW Listening Session",
    state: session.state, sequence: session.sequence, currentItemId: session.currentItemId,
    mediaPosition: session.mediaPosition, effectiveAt: session.effectiveAt, isPlaying: session.isPlaying,
    musicGain: session.musicGain, videoPolicy: session.videoPolicy,
    scheduledAt: session.scheduledAt, startedAt: session.startedAt, endedAt: session.endedAt,
    look: session.look, visualCue: session.visualCue || null,
    items: session.items.map((item) => ({ id: item.id, position: item.position,
      title: session.presentation?.showTracklist ? item.title : "", durationSeconds: item.durationSeconds,
      excluded: item.excluded, completed: item.completed, prepared: item.prepared })),
  };
}
