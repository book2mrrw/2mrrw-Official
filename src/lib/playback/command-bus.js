/**
 * Observable event stream for playback command lifecycle.
 *
 * Events: "command:issued" | "command:started" | "command:completed" |
 *         "command:failed" | "command:timeout"
 *
 * Usage:
 *   const off = getPlaybackCommandBus().on("command:completed", (e) => {
 *     console.log(e.type, e.requestId, e.result);
 *   });
 *   // later:
 *   off(); // unsubscribe
 *
 *   // Wildcard — every event:
 *   getPlaybackCommandBus().on("*", (e) => { ... });
 *
 *   // Recent history (last 50 entries):
 *   getPlaybackCommandBus().getHistory();
 */

/**
 * @typedef {"command:issued"|"command:started"|"command:completed"|"command:failed"|"command:timeout"|"*"} CommandBusEvent
 */

/**
 * @typedef {Object} CommandBusEntry
 * @property {string}  event      The event name.
 * @property {number}  at         Timestamp (Date.now()).
 * @property {string}  type       PLAYBACK_COMMANDS constant.
 * @property {number}  requestId  Monotonic request counter.
 * @property {any}     [result]   Present on "command:completed".
 * @property {string}  [error]    Present on "command:failed".
 * @property {number}  [timeoutMs] Present on "command:timeout".
 */

class PlaybackCommandBus {
  constructor() {
    /** @type {Map<string, Set<(entry: CommandBusEntry) => void>>} */
    this._listeners = new Map();
    /** @type {CommandBusEntry[]} */
    this._ring = [];
    this._ringSize = 50;
  }

  /**
   * @param {string} event
   * @param {Record<string, any>} data
   */
  emit(event, data) {
    const entry = /** @type {CommandBusEntry} */ ({ event, at: Date.now(), ...data });
    this._ring.push(entry);
    if (this._ring.length > this._ringSize) this._ring.shift();

    const fns = this._listeners.get(event);
    if (fns) for (const fn of fns) { try { fn(entry); } catch {} }

    const wildcards = this._listeners.get("*");
    if (wildcards) for (const fn of wildcards) { try { fn(entry); } catch {} }
  }

  /**
   * Subscribe to a lifecycle event (or "*" for all events).
   * @param {CommandBusEvent} event
   * @param {(entry: CommandBusEntry) => void} listener
   * @returns {() => void} Unsubscribe function.
   */
  on(event, listener) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(listener);
    return () => this._listeners.get(event)?.delete(listener);
  }

  /**
   * Returns a snapshot of the last 50 lifecycle events (newest last).
   * @returns {CommandBusEntry[]}
   */
  getHistory() {
    return this._ring.slice();
  }
}

/** @type {PlaybackCommandBus|null} */
let _bus = null;

/**
 * Module-level singleton — one bus per tab.
 * @returns {PlaybackCommandBus}
 */
export function getPlaybackCommandBus() {
  if (!_bus) _bus = new PlaybackCommandBus();
  return _bus;
}
