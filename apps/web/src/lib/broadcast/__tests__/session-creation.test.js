import test from "node:test";
import assert from "node:assert/strict";
import { createBroadcastSession, normalizeSessionCreation } from "../session-creation.js";
import { applySessionCommand } from "../session-model.js";

const sessionId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const releaseId = "33333333-3333-4333-8333-333333333333";
const input = { sessionId, title: "Listening room", type: "listening_session", releaseId };
function fixture() {
  let row;
  let resolves = 0;
  return {
    get resolves() { return resolves; },
    repository: {
      async loadOwned(id, actor) { return row?.id === id && row.host_id === actor ? row : null; },
      async create(next) { row = next; return { session: row.snapshot, duplicate: false }; },
    },
    async resolveProject() { resolves++; return { releaseId, items: [{ trackId: "canonical-track", title: "Original", prepared: false }] }; },
  };
}
const create = (f, request = input) => createBroadcastSession({ ...f, input: request, actorId, now: () => 1000, uuid: () => "stable-session-item" });

test("creation keeps canonical identity, ignores client track/readiness injection, and starts private", async () => {
  const f = fixture();
  const { session } = await create(f, { ...input, items: [{ trackId: "foreign", prepared: true }], state: "TRACK_PLAYBACK" });
  assert.equal(session.releaseId, releaseId);
  assert.equal(session.items[0].trackId, "canonical-track");
  assert.equal(session.items[0].prepared, false);
  assert.equal(session.state, "DRAFT");
  assert.equal(session.accessPolicy, "ADMIN");
  assert.equal(session.replayPolicy, "NO_REPLAY");
  assert.throws(() => applySessionCommand(session, { type: "GO_LIVE", expectedSequence: 0 }, 2000), /prepared/);
});

test("creation retry returns original session and does not resolve or duplicate tracks", async () => {
  const f = fixture();
  const first = await create(f);
  const retry = await create(f);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.session, first.session);
  assert.equal(f.resolves, 1);
  await assert.rejects(create(f, { ...input, title: "Different intent" }), { code: "SESSION_ID_CONFLICT" });
});

test("nonmusic session types do not require a music selection", async () => {
  for (const type of ["regular_live", "interview", "concert", "mic_drop", "podcast"]) {
    const f = fixture();
    const result = await create(f, { sessionId, title: "Artist live", type });
    assert.equal(f.resolves, 0);
    assert.deepEqual(result.session.items, []);
  }
});

test("invalid project, policy, and presentation selections fail before persistence", () => {
  for (const change of [
    { releaseId: null }, { productId: releaseId }, { releaseId: "bad" },
    { accessPolicy: "UNRESTRICTED" }, { accessPolicy: "ENTRY" },
    { presentation: { showTitle: "false" } }, { look: { world: "unknown" } },
  ]) assert.throws(() => normalizeSessionCreation({ ...input, ...change }));
});

test("missing and oversized projects fail rather than silently dropping tracks", async () => {
  const f = fixture();
  await assert.rejects(create({ ...f, resolveProject: async () => null }), { status: 404 });
  await assert.rejects(create({ ...f, resolveProject: async () => ({ releaseId, items: Array(201).fill({}) }) }), { status: 400 });
});
