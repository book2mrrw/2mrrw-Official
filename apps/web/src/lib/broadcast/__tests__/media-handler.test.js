import test from "node:test";
import assert from "node:assert/strict";
import { createBroadcastMediaHandler } from "../media-handler.js";
import { BroadcastServiceError } from "../command-service.js";
import { proxySignedR2Get } from "../../server/r2-stream-proxy.js";

const itemId = "11111111-1111-4111-8111-111111111111";
const url = `https://www.2mrrw.com/api/broadcast/sessions/session/media?itemId=${itemId}`;
const context = { params: Promise.resolve({ id: "session" }) };
function setup({ state = "TRACK_PLAYBACK", denied = false } = {}) {
  let signs = 0;
  const serve = createBroadcastMediaHandler({
    async authorizeBroadcastListener() {
      if (denied) throw new BroadcastServiceError("Denied", 403);
      return { client: {}, session: { state, currentItemId: itemId, items: [{ id: itemId, position: 0 }] }, admin: false };
    },
    async resolveBroadcastMedia() { return { key: "secret/master.wav", storageScope: "private" }; },
    async createR2SignedGetUrl(key, ttl, options) {
      signs++;
      assert.equal(key, "secret/master.wav"); assert.equal(ttl, 60); assert.equal(options.storageScope, "private");
      return "https://storage.invalid/secret?signature=private";
    },
    proxySignedR2Get,
  });
  return { serve, get signs() { return signs; } };
}

test("HTTP Range response preserves audio bytes and strips reusable cache lifetime", async () => {
  const original = globalThis.fetch;
  let range;
  globalThis.fetch = async (_, options) => {
    range = options.headers.Range;
    return new Response("audio", { status: 206, headers: { "Content-Type": "audio/wav", "Content-Length": "5", "Content-Range": "bytes 0-4/100" } });
  };
  try {
    const { serve } = setup();
    const result = await serve(new Request(url, { headers: { Range: "bytes=0-4" } }), context);
    assert.equal(result.status, 206);
    assert.equal(range, "bytes=0-4");
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.equal(result.headers.get("content-range"), "bytes 0-4/100");
    assert.equal(result.headers.get("location"), null);
    assert.equal(await result.text(), "audio");
  } finally { globalThis.fetch = original; }
});

test("denial, cross-origin requests and session end reject before signing", async () => {
  for (const options of [{ state: "ENDED" }, { denied: true }]) {
    const f = setup(options);
    const response = await f.serve(new Request(url), context);
    assert.equal(response.status, 403);
    assert.equal(f.signs, 0);
  }
  const f = setup();
  assert.equal((await f.serve(new Request(url, { headers: { Origin: "https://other.invalid" } }), context)).status, 403);
  assert.equal(f.signs, 0);
});

test("upstream error bodies cannot expose storage keys or signatures", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("secret/master.wav signature=private", { status: 403 });
  try {
    const response = await setup().serve(new Request(url), context);
    assert.equal(response.status, 502);
    assert.equal(await response.text(), '{"error":"Media unavailable"}');
  } finally { globalThis.fetch = original; }
});

test("HEAD delivers no body and requests upstream HEAD", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_, options) => { assert.equal(options.method, "HEAD"); return new Response(null, { headers: { "Content-Length": "100" } }); };
  try {
    const response = await setup().serve(new Request(url, { method: "HEAD" }), context);
    assert.equal(response.status, 200);
    assert.equal(response.body, null);
    assert.equal(response.headers.get("content-length"), "100");
  } finally { globalThis.fetch = original; }
});

test("existing library proxy retains its established default cache policy", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("audio");
  try { assert.equal((await proxySignedR2Get(new Request(url), "https://storage.invalid")).headers.get("cache-control"), "private, max-age=3300"); }
  finally { globalThis.fetch = original; }
});
