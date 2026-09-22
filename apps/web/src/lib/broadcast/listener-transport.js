import { SessionClock, expectedPosition, driftCorrection, reconcileSnapshot } from "./session-clock.js";

/** Persistent transport owner. Views only subscribe; removing a view never calls leave(). */
export class BroadcastListenerTransport {
  constructor({ createAudio, focus, fetcher = fetch, monotonicNow = () => performance.now(), timers = globalThis }) {
    this.createAudio = createAudio;
    this.focus = focus;
    this.fetcher = fetcher;
    this.now = monotonicNow;
    this.timers = timers;
    this.clock = new SessionClock({ monotonicNow });
    this.listeners = new Set();
    this.state = Object.freeze({ phase: "idle", session: null, error: null, listening: false });
    this.decks = [];
    this.active = null;
    this.epoch = 0;
    this.request = null;
    this.lastCorrection = -Infinity;
  }

  getSnapshot = () => this.state;
  subscribe = (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  publish(patch) {
    if (Object.entries(patch).every(([key, value]) => this.state[key] === value)) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) { try { listener(); } catch { /* Presentation failure cannot stop transport. */ } }
  }
  ensureDecks() {
    if (this.decks.length) return;
    this.decks = [0, 1].map(() => {
      const audio = this.createAudio();
      audio.preload = "metadata";
      audio.muted = true;
      const deck = { audio, itemId: null, sessionId: null, pending: null, generation: 0 };
      audio.addEventListener("canplay", () => { if (this.active === deck) this.synchronize(); });
      audio.addEventListener("error", () => { if (this.active === deck) this.publish({ error: "Audio connection interrupted" }); });
      return deck;
    });
  }
  load(deck, sessionId, itemId) {
    if (deck.sessionId === sessionId && deck.itemId === itemId) return;
    deck.generation++;
    deck.pending = null;
    deck.audio.pause();
    deck.audio.muted = true;
    deck.itemId = itemId;
    deck.sessionId = sessionId;
    deck.audio.src = `/api/broadcast/sessions/${encodeURIComponent(sessionId)}/media?itemId=${encodeURIComponent(itemId)}`;
    // src assignment starts preparation. No redundant load() call or signed-URL rotation.
  }
  async prepare(sessionId) {
    if (this.state.listening && this.sessionId !== sessionId) throw new Error("Leave the current session before entering another");
    this.ensureDecks();
    if (this.sessionId !== sessionId) {
      this.request?.controller.abort();
      this.sessionId = sessionId;
      this.epoch++;
      this.active = null;
      this.publish({ session: null, phase: "preparing", error: null });
    }
    return this.refresh();
  }
  refresh() {
    if (this.request?.sessionId === this.sessionId) return this.request.promise;
    const sessionId = this.sessionId;
    if (!sessionId) return Promise.resolve();
    const epoch = this.epoch;
    const controller = new AbortController();
    const sentAt = this.now();
    const request = { controller, sessionId, promise: null };
    request.promise = (async () => {
      try {
        const response = await this.fetcher(`/api/broadcast/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const body = await response.json();
        if (epoch !== this.epoch) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) await this.leave({ resumePersonal: false });
          throw new Error("Session connection unavailable");
        }
        this.clock.sample({ sentAt, receivedAt: this.now(), serverTime: body.serverTime });
        this.publish({ error: null });
        this.accept(body.session);
      } catch (error) {
        if (epoch === this.epoch && error.name !== "AbortError") this.publish({ error: "Session connection interrupted" });
      } finally { if (this.request === request) this.request = null; }
    })();
    this.request = request;
    return request.promise;
  }
  accept(incoming) {
    if (incoming?.id !== this.sessionId) return;
    if (!reconcileSnapshot(this.state.session, incoming).accept) return;
    this.publish({ session: incoming, error: null, phase: incoming.state === "ENDED" ? "ended" : "ready" });
    if (incoming.state === "ENDED") { void this.leave({ resumePersonal: false, ended: true }); return; }
    const items = incoming.items.filter((item) => !item.excluded && !item.completed).sort((a, b) => a.position - b.position);
    const current = items.find((item) => item.id === incoming.currentItemId) || items[0];
    if (!current) return;
    let active = this.decks.find((deck) => deck.itemId === current.id && deck.sessionId === incoming.id);
    if (!active) {
      active = this.decks.find((deck) => deck !== this.active) || this.decks[0];
      this.load(active, incoming.id, current.id);
    }
    if (active !== this.active) {
      this.active?.audio.pause();
      if (this.active) this.active.audio.muted = true;
      this.active = active;
      this.lastCorrection = -Infinity;
    }
    const next = items[items.indexOf(current) + 1];
    if (next) this.load(this.decks.find((deck) => deck !== active), incoming.id, next.id);
    this.synchronize();
  }
  // Call directly inside the entry gesture. Unlock before awaiting focus/network.
  async enter(sessionId) {
    if (this.state.listening && this.sessionId === sessionId) return;
    if (this.sessionId !== sessionId || !this.active) throw new Error("Prepare the session before entering");
    if (this.entering) return this.entering;
    const epoch = this.epoch;
    const deck = this.active;
    deck.audio.muted = true;
    const unlock = deck.audio.play();
    // Attach rejection handler immediately: focus acquisition may take longer than autoplay rejection.
    const unlocked = Promise.resolve(unlock).then(() => true, () => false);
    this.entering = (async () => {
      const release = await this.focus.acquire();
      if (epoch !== this.epoch) { await release({ resumePersonal: false }); return; }
      this.releaseFocus = release;
      if (!await unlocked) { await this.leave({ resumePersonal: false }); this.publish({ error: "Tap to enable session audio" }); return; }
      if (epoch !== this.epoch) return;
      await this.refresh();
      if (epoch !== this.epoch || this.state.session?.state === "ENDED") return;
      this.publish({ listening: true });
      this.synchronize();
      this.pollTimer = this.timers.setInterval(() => { void this.refresh(); }, 2000);
      this.syncTimer = this.timers.setInterval(() => this.synchronize(), 250);
    })().catch(async (error) => { await this.leave({ resumePersonal: false }); this.publish({ error: error.message || "Audio focus unavailable" }); })
      .finally(() => { this.entering = null; });
    return this.entering;
  }
  synchronize() {
    const session = this.state.session;
    const deck = this.active;
    if (!deck || !session) return;
    const audio = deck.audio;
    const serverNow = this.clock.serverNow();
    const playing = this.state.listening && session.isPlaying && session.state !== "ENDED" &&
      Number.isFinite(serverNow) && Number.isFinite(session.effectiveAt) && serverNow >= session.effectiveAt;
    if (!playing) { audio.pause(); audio.muted = true; return; }
    if (audio.readyState < 2) return;
    const expected = expectedPosition(session, serverNow);
    const correction = driftCorrection({ actual: audio.currentTime, expected, uncertaintyMs: this.clock.diagnostics().uncertaintyMs,
      sinceCorrectionMs: this.now() - this.lastCorrection });
    if (correction.type === "seek") { audio.currentTime = correction.position; this.lastCorrection = this.now(); }
    audio.playbackRate = correction.rate;
    audio.volume = session.musicGain ?? 1;
    audio.muted = false;
    if (audio.paused && !deck.pending) {
      const epoch = this.epoch;
      const generation = ++deck.generation;
      deck.pending = Promise.resolve(audio.play()).catch(() => {
        if (epoch === this.epoch && generation === deck.generation && this.active === deck) this.publish({ error: "Tap to resume session audio" });
      }).finally(() => {
        // A reused deck belongs to its new operation. Old completions cannot mutate it.
        if (generation !== deck.generation) return;
        deck.pending = null;
        if (epoch !== this.epoch || this.active !== deck || !this.state.listening) { audio.pause(); audio.muted = true; }
      });
    }
  }
  async leave({ resumePersonal = true, ended = false } = {}) {
    this.epoch++;
    this.request?.controller.abort();
    this.request = null;
    this.timers.clearInterval(this.pollTimer);
    this.timers.clearInterval(this.syncTimer);
    for (const deck of this.decks) {
      deck.generation++;
      deck.pending = null;
      deck.audio.pause();
      deck.audio.muted = true;
    }
    this.publish({ listening: false, phase: ended ? "ended" : "ready" });
    const release = this.releaseFocus;
    this.releaseFocus = null;
    await release?.({ resumePersonal });
  }
}
