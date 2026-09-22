/** Session time is anchored to a monotonic clock; wall-clock changes cannot seek media. */
export class SessionClock {
  constructor({ monotonicNow = () => performance.now(), maxSamples = 12 } = {}) {
    this.now = monotonicNow;
    this.maxSamples = maxSamples;
    this.samples = [];
    this.anchor = null;
  }

  sample({ sentAt, receivedAt, serverTime }) {
    const rtt = receivedAt - sentAt;
    if (![sentAt, receivedAt, serverTime].every(Number.isFinite) || rtt < 0 || rtt > 10000) return false;
    this.samples.push({ rtt, offset: serverTime - (sentAt + receivedAt) / 2 });
    this.samples = this.samples.slice(-this.maxSamples);
    // Low RTT samples have the smallest uncertainty. Median resists one anomalous response.
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3);
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
    this.anchor = { offset: offsets[Math.floor(offsets.length / 2)], uncertaintyMs: best[0].rtt / 2 };
    return true;
  }

  serverNow() { return this.anchor ? this.now() + this.anchor.offset : null; }
  diagnostics() { return { ready: Boolean(this.anchor), samples: this.samples.length, ...this.anchor }; }
}

export function expectedPosition(session, serverNow) {
  const position = Math.max(0, Number(session.mediaPosition) || 0);
  if (!session.isPlaying || !Number.isFinite(serverNow) || !Number.isFinite(session.effectiveAt)) return position;
  const elapsed = Math.max(0, serverNow - session.effectiveAt) / 1000;
  const current = session.items?.find((item) => item.id === session.currentItemId);
  const duration = Number(current?.durationSeconds);
  return duration > 0 ? Math.min(duration, position + elapsed) : position + elapsed;
}

/** Pure correction policy. No source assignment, reload, or player construction. */
export function driftCorrection({ actual, expected, uncertaintyMs = 0, sinceCorrectionMs = Infinity }) {
  if (![actual, expected].every(Number.isFinite)) return { type: "none", rate: 1 };
  const drift = expected - actual;
  const deadband = Math.max(0.08, uncertaintyMs / 1000);
  if (Math.abs(drift) <= deadband) return { type: "none", rate: 1, drift };
  if (Math.abs(drift) >= Math.max(1.5, deadband * 4) && sinceCorrectionMs >= 5000) {
    return { type: "seek", position: expected, rate: 1, drift };
  }
  return { type: "rate", rate: 1 + Math.max(-0.02, Math.min(0.02, drift * 0.025)), drift };
}

/** Reconnection always uses a current authorized snapshot, never replay from track zero. */
export function reconcileSnapshot(current, incoming) {
  if (!incoming || !Number.isSafeInteger(incoming.sequence) || incoming.sequence < 0) return { accept: false, reason: "invalid" };
  if (current && current.id !== incoming.id) return { accept: false, reason: "different_session" };
  if (current && incoming.sequence <= current.sequence) return { accept: false, reason: "stale" };
  return {
    accept: true,
    gap: Boolean(current && incoming.sequence > current.sequence + 1),
    sameMedia: Boolean(current && current.currentItemId === incoming.currentItemId),
    snapshot: incoming,
  };
}
