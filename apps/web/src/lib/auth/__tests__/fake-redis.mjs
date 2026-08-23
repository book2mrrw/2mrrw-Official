/**
 * FakeRedis — a Redis model faithful enough to prove or disprove atomicity.
 *
 * The single property that matters for these tests is the one real Redis
 * guarantees and a naive mock does not:
 *
 *   EVAL runs to completion with NO other command interleaved.
 *   GET / SET / INCR issued separately MAY interleave arbitrarily.
 *
 * If the mock made everything atomic, a torture test would pass against a broken
 * read-then-write implementation and prove nothing. So:
 *
 *   - eval()  acquires a mutex for the whole script, awaiting nothing inside it
 *   - get/set/incr each yield to the event loop BEFORE acting, which forces the
 *     interleaving that exposes a non-atomic sequence
 *
 * Lua support is limited to exactly the shapes used by the entitlement and
 * capability scripts — GET, SET (with EX), INCR, EXPIRE, tostring, tonumber,
 * table returns, and `== false` for absent keys.
 */

export class FakeRedis {
  constructor() {
    this.store = new Map();
    this.ops = { get: 0, set: 0, incr: 0, eval: 0, expire: 0 };
    this._chain = Promise.resolve();
    this.failing = false;
  }

  /** Simulate an unreachable store: every command rejects. */
  setFailing(on) { this.failing = on; }

  _guard() {
    if (this.failing) throw new Error("ECONNREFUSED (simulated)");
  }

  /** Run fn with exclusive access — models Redis's single-threaded execution. */
  _atomic(fn) {
    const run = this._chain.then(() => fn());
    // Keep the chain alive even when a script throws.
    this._chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async get(key) {
    await Promise.resolve();          // force interleave opportunity
    this._guard();
    this.ops.get += 1;
    const v = this.store.get(key);
    return v === undefined ? null : v;
  }

  async set(key, value, opts) {
    await Promise.resolve();
    this._guard();
    this.ops.set += 1;
    this.store.set(key, String(value));
    void opts;
    return "OK";
  }

  async setex(key, _ttl, value) {
    await Promise.resolve();
    this._guard();
    this.ops.set += 1;
    this.store.set(key, String(value));
    return "OK";
  }

  async incr(key) {
    await Promise.resolve();
    this._guard();
    this.ops.incr += 1;
    const next = (Number(this.store.get(key)) || 0) + 1;
    this.store.set(key, String(next));
    return next;
  }

  async expire(key, _ttl) {
    await Promise.resolve();
    this._guard();
    this.ops.expire += 1;
    return this.store.has(key) ? 1 : 0;
  }

  async del(key) {
    await Promise.resolve();
    this._guard();
    return this.store.delete(key) ? 1 : 0;
  }

  pipeline() {
    const cmds = [];
    const self = this;
    return {
      del(k) { cmds.push(["del", k]); return this; },
      async exec() {
        self._guard();
        for (const [, k] of cmds) self.store.delete(k);
        return cmds.map(() => 1);
      },
    };
  }

  /**
   * Atomic script execution. The whole body runs synchronously inside one
   * mutex-held turn — exactly the guarantee the production code depends on.
   */
  eval(script, keys = [], argv = []) {
    return this._atomic(() => {
      this._guard();
      this.ops.eval += 1;
      return this._runScript(script, keys, argv);
    });
  }

  _runScript(script, KEYS, ARGV) {
    const k = (i) => KEYS[i - 1];
    const a = (i) => ARGV[i - 1];
    const rawGet = (key) => {
      const v = this.store.get(key);
      return v === undefined ? false : v;      // Lua: nil → false
    };
    const rawIncr = (key) => {
      const n = (Number(this.store.get(key)) || 0) + 1;
      this.store.set(key, String(n));
      return n;
    };

    // ── capability CAS ────────────────────────────────────────────────────
    if (script.includes("local stored = redis.call('GET', KEYS[1])")) {
      const stored = rawGet(k(1));
      if (stored === a(1)) {
        const v = rawGet(k(2));
        return [0, String(v === false ? "0" : v)];
      }
      let ver;
      let code;
      if (stored === false) {
        const existing = rawGet(k(2));
        ver = existing === false ? rawIncr(k(2)) : Number(existing);
        code = 2;
      } else {
        ver = rawIncr(k(2));
        code = 1;
      }
      this.store.set(k(1), a(1));
      return [code, String(ver)];
    }

    // ── generation + value snapshot ───────────────────────────────────────
    if (script.includes("local gen = redis.call('GET', KEYS[1])")) {
      const gen = rawGet(k(1));
      const val = rawGet(k(2));
      return [String(gen === false ? "0" : gen), String(val === false ? "" : val)];
    }

    // ── generation bump ───────────────────────────────────────────────────
    if (script.includes("local v = redis.call('INCR', KEYS[1])")) {
      return String(rawIncr(k(1)));
    }

    throw new Error("FakeRedis: unsupported script\n" + script);
  }
}
