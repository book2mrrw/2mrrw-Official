import test from "node:test";
import assert from "node:assert/strict";
import { executeBroadcastCommand, validateBroadcastCommand } from "../command-service.js";

const sessionId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const command = { commandId, expectedSequence: 0, type: "GO_LIVE", payload: {} };

// In-memory atomic repository simulation. These test service behavior, not PostgreSQL locks/RLS.
function repositoryFixture() {
  let snapshot = { id: sessionId, type: "interview", state: "DRAFT", sequence: 0, items: [], isPlaying: false, mediaPosition: 0 };
  const events = new Map();
  return {
    events,
    async loadOwned(id, actor) { return id === sessionId && actor === actorId ? { snapshot: structuredClone(snapshot) } : null; },
    async findCommand(id, key) { return events.get(key) || null; },
    async commit(args) {
      const existing = events.get(args.command.commandId);
      if (existing) return existing.command_fingerprint === args.fingerprint
        ? { session: structuredClone(snapshot), eventId: existing.id, duplicate: true }
        : { error: "IDEMPOTENCY_CONFLICT" };
      if (args.command.expectedSequence !== snapshot.sequence) return { error: "SEQUENCE_CONFLICT", session: structuredClone(snapshot) };
      snapshot = structuredClone(args.snapshot);
      events.set(args.command.commandId, { id: args.command.commandId, command_fingerprint: args.fingerprint });
      return { session: structuredClone(snapshot), eventId: args.command.commandId, duplicate: false };
    },
  };
}
const execute = (repository, cmd = command, actor = actorId) => executeBroadcastCommand({ repository, sessionId, actorId: actor, command: cmd, now: () => 1000 });

test("simultaneous duplicate commands create one event", async () => {
  const repository = repositoryFixture();
  const results = await Promise.all([execute(repository), execute(repository)]);
  assert.equal(repository.events.size, 1);
  assert.deepEqual(results.map((r) => r.session.sequence), [1, 1]);
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
});

test("concurrent distinct commands cannot overwrite the winning transition", async () => {
  const repository = repositoryFixture();
  const results = await Promise.allSettled([execute(repository), execute(repository, { ...command, commandId: "44444444-4444-4444-8444-444444444444", type: "PRE_SHOW" })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const failure = results.find((r) => r.status === "rejected").reason;
  assert.equal(failure.code, "SEQUENCE_CONFLICT");
  assert.equal(failure.session.sequence, 1);
  assert.equal(repository.events.size, 1);
});

test("retry after later commands acknowledges old event with current snapshot", async () => {
  const repository = repositoryFixture();
  await execute(repository);
  await execute(repository, { ...command, commandId: "44444444-4444-4444-8444-444444444444", expectedSequence: 1, type: "END_SESSION" });
  const retry = await execute(repository);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.session.state, "ENDED");
  assert.equal(retry.session.sequence, 2);
});

test("reusing command identity with different intent is rejected", async () => {
  const repository = repositoryFixture();
  await execute(repository);
  await assert.rejects(execute(repository, { ...command, type: "PRE_SHOW" }), { code: "IDEMPOTENCY_CONFLICT" });
  assert.equal(repository.events.size, 1);
});

test("other actors and invalid commands cannot mutate or inspect a session", async () => {
  const repository = repositoryFixture();
  await assert.rejects(execute(repository, command, "44444444-4444-4444-8444-444444444444"), { code: "NOT_FOUND" });
  await assert.rejects(execute(repository, { ...command, commandId: "bad" }), { code: "INVALID_COMMAND" });
  await assert.rejects(execute(repository, { ...command, type: "START_TRACK" }), { status: 422 });
  assert.equal(repository.events.size, 0);
});

test("payload ordering does not change idempotency identity; oversized commands reject", () => {
  assert.equal(validateBroadcastCommand({ ...command, payload: { a: 1, b: 2 } }), validateBroadcastCommand({ ...command, payload: { b: 2, a: 1 } }));
  assert.throws(() => validateBroadcastCommand({ ...command, payload: { text: "x".repeat(17000) } }), { code: "COMMAND_TOO_LARGE" });
});
