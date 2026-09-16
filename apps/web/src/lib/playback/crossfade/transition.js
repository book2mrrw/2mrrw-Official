export const CROSSFADE_SECONDS = 4;
export const PREPARE_SECONDS = 20;

export const trackIdentity = (track) => track?.id ?? track?.trackId ?? track?.slug ?? null;

export function eligiblePair(snapshot) {
  const { track, next, playing, blocked, remaining } = snapshot;
  const full = (item) => item?.metadata?.access?.canStream === true && !item.metadata.access.previewOnly;
  const collection = (item) => item?.source === 'playlist' || Boolean(item?.metadata?.albumSlug);
  return Boolean(playing && !blocked && Number.isFinite(remaining) && remaining > 0.25 &&
    trackIdentity(track) && trackIdentity(next) && trackIdentity(track) !== trackIdentity(next) &&
    full(track) && full(next) && collection(track) && collection(next));
}

// Audio-thread automation, separate from React and from representation switching.
export function fadeCurves(outgoingGain = 1, incomingGain = 1) {
  const out = new Float32Array(65);
  const incoming = new Float32Array(65);
  for (let i = 0; i < out.length; i++) {
    const angle = (i / (out.length - 1)) * Math.PI / 2;
    out[i] = Math.cos(angle) * outgoingGain;
    incoming[i] = Math.sin(angle) * incomingGain;
  }
  out[out.length - 1] = 0;
  incoming[0] = 0;
  return { out, incoming };
}

/** One candidate, one attempt per queue occurrence; no timer or media allocation
 * until explicitly enabled. Injected dependencies keep lifecycle tests honest. */
export class CrossfadeTransition {
  constructor({ snapshot, prepare, request, release }) {
    this.snapshot = snapshot;
    this.prepare = prepare;
    this.request = request;
    this.release = release;
    this.enabled = false;
    this.candidate = null;
    this.attempted = null;
    this.sequence = 0;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    if (!this.enabled) { this.cancel(); this.attempted = null; }
  }

  valid(candidate, snapshot = this.snapshot()) {
    return this.candidate === candidate && !candidate.abort.signal.aborted &&
      eligiblePair(snapshot) && snapshot.key === candidate.key;
  }

  tick() {
    if (!this.enabled) return;
    const snapshot = this.snapshot();
    if (this.candidate && !this.valid(this.candidate, snapshot)) this.cancel();
    if (!eligiblePair(snapshot) || snapshot.remaining > PREPARE_SECONDS) return;
    if (!this.candidate && this.attempted !== snapshot.key && snapshot.canPrepare) {
      this.attempted = snapshot.key;
      const candidate = { ...snapshot, abort: new AbortController(), token: ++this.sequence, deck: null, requested: false };
      this.candidate = candidate;
      Promise.resolve().then(() => this.valid(candidate) ? this.prepare(candidate) : null)
        .then((deck) => {
          if (!deck) { if (this.candidate === candidate) this.cancel(); return; }
          if (!this.valid(candidate)) { this.release(deck); return; }
          candidate.deck = deck;
          this.tick();
        }).catch(() => { if (this.candidate === candidate) this.cancel(); });
    }
    const candidate = this.candidate;
    if (candidate?.deck && !candidate.requested && snapshot.remaining <= CROSSFADE_SECONDS) {
      candidate.requested = true;
      // Silent play validation happens before submitting any new playback intent.
      Promise.resolve().then(() => candidate.deck.prime())
        .then((ready) => {
          if (!ready || !this.valid(candidate)) { if (this.candidate === candidate) this.cancel(); return; }
          if (this.request(candidate) === false) this.cancel();
        }).catch(() => { if (this.candidate === candidate) this.cancel(); });
    }
  }

  take(token, track) {
    const candidate = this.candidate;
    if (!candidate || candidate.token !== token || trackIdentity(candidate.next) !== trackIdentity(track) ||
        !this.valid(candidate) || !candidate.deck?.ready()) return null;
    this.candidate = null;
    return candidate;
  }

  cancel() {
    const candidate = this.candidate;
    this.candidate = null;
    if (!candidate) return;
    candidate.abort.abort();
    if (candidate.deck) this.release(candidate.deck);
  }
}
