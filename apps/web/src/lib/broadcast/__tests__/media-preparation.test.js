import test from "node:test";
import assert from "node:assert/strict";
import { prepareBroadcastMedia, probeBroadcastMedia } from "../media-preparation.js";
import { applySessionCommand } from "../session-model.js";
import { executeBroadcastCommand } from "../command-service.js";

const media = { key: "private/master.wav", storageScope: "private" };
const sign = async (key, ttl, options) => {
  assert.equal(key, media.key); assert.equal(ttl, 60); assert.equal(options.storageScope, "private");
  return "https://storage.test/signed";
};
const valid = () => new Response(new Uint8Array(1024), { status: 206,
  headers: { "Content-Type": "audio/wav", "Content-Range": "bytes 0-1023/9000" } });
const session = { id: "11111111-1111-4111-8111-111111111111", state: "DRAFT", type: "listening_session", sequence: 0,
  isPlaying: false, mediaPosition: 0, items: [{ id: "one", prepared: false, position: 0 }] };
const command = { commandId: "22222222-2222-4222-8222-222222222222", type: "PREPARE_MEDIA", expectedSequence: 0, payload: {} };

test("delivery verification reads a bounded signed range and emits no storage data", async () => {
  const result = await prepareBroadcastMedia(session, { resolve: async () => media, sign, fetcher: async (url, options) => {
    assert.equal(options.headers.Range, "bytes=0-1023"); assert.equal(options.redirect, "error");
    return valid();
  } });
  assert.deepEqual(result, [{ id: "one", prepared: true }]);
});

test("denied, truncated, non-audio, empty and unbounded delivery fail closed", async () => {
  for (const response of [new Response("denied", { status: 403 }), new Response("whole file"),
    new Response("short", { status: 206, headers: { "Content-Type": "audio/wav", "Content-Range": "bytes 0-1023/9000" } }),
    new Response("<html>", { status: 206, headers: { "Content-Type": "text/html", "Content-Range": "bytes 0-5/6" } }),
    new Response(new Uint8Array(1025), { status: 206, headers: { "Content-Type": "audio/wav", "Content-Range": "bytes 0-1023/9000" } }),
  ]) assert.equal(await probeBroadcastMedia(media, { sign, fetcher: async () => response }), false);
});

test("missing or excluded objects cannot become ready; cancellation prevents readiness", async () => {
  let signs = 0;
  const resolve = async () => null;
  const options = { resolve, sign: async () => { signs++; } };
  assert.deepEqual(await prepareBroadcastMedia(session, options), [{ id: "one", prepared: false }]);
  assert.equal(signs, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareBroadcastMedia(session, { ...options, signal: controller.signal }));
});

test("client readiness injection is rejected while server evidence preserves canonical items", () => {
  assert.throws(() => applySessionCommand(session, { ...command, payload: { mediaReadiness: [{ id: "one", prepared: true }] } }, 1000), /Server media/);
  const next = applySessionCommand(session, command, 1000, { mediaReadiness: [{ id: "one", prepared: true }] });
  assert.equal(next.items[0].prepared, true); assert.equal(next.sequence, 1); assert.equal(session.items[0].prepared, false);
  assert.throws(() => applySessionCommand({ ...session, state: "TRACK_PLAYBACK" }, command, 1000, { mediaReadiness: [] }), /before going live/);
});

test("readiness still uses sequence CAS after asynchronous delivery probes", async () => {
  let probed = false;
  const repository = {
    loadOwned: async () => ({ snapshot: session }), findCommand: async () => null,
    commit: async ({ snapshot }) => { assert.equal(probed, true); assert.equal(snapshot.items[0].prepared, true);
      return { error: "SEQUENCE_CONFLICT", session: { ...session, sequence: 1 } }; },
  };
  await assert.rejects(executeBroadcastCommand({ repository, sessionId: session.id,
    actorId: "33333333-3333-4333-8333-333333333333", command,
    prepareMedia: async () => { probed = true; return [{ id: "one", prepared: true }]; },
  }), { code: "SEQUENCE_CONFLICT" });
});
