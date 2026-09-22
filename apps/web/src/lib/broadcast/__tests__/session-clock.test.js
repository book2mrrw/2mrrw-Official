import test from "node:test";
import assert from "node:assert/strict";
import { SessionClock, expectedPosition, driftCorrection, reconcileSnapshot } from "../session-clock.js";

for (const latency of [50, 250, 1000]) {
  test(`clock aligns a delayed client at ${latency}ms RTT`, () => {
    let mono = 100;
    const clock = new SessionClock({ monotonicNow: () => mono });
    clock.sample({ sentAt: 100, receivedAt: 100 + latency, serverTime: 50000 + 100 + latency / 2 });
    mono += 3000;
    assert.equal(clock.serverNow(), 53100);
    assert.equal(clock.diagnostics().uncertaintyMs, latency / 2);
  });
}

test("clock rejects malformed samples and bounds sample memory", () => {
  const clock = new SessionClock({ monotonicNow: () => 100 });
  assert.equal(clock.serverNow(), null);
  assert.equal(clock.sample({ sentAt: 2, receivedAt: 1, serverTime: 100 }), false);
  assert.equal(clock.sample({ sentAt: 1, receivedAt: 2, serverTime: NaN }), false);
  for (let n = 0; n < 100; n++) clock.sample({ sentAt: n, receivedAt: n + 10, serverTime: n + 1005 });
  assert.equal(clock.samples.length, 12);
  assert.equal(clock.serverNow(), 1100);
});

test("late reconnect resumes authoritative position and respects pause/duration", () => {
  const session = { currentItemId: "a", mediaPosition: 30, effectiveAt: 10000, isPlaying: true, items: [{ id: "a", durationSeconds: 180 }] };
  assert.equal(expectedPosition(session, 40000), 60);
  assert.equal(expectedPosition({ ...session, isPlaying: false }, 40000), 30);
  assert.equal(expectedPosition(session, 500000), 180);
  assert.equal(expectedPosition(session, 9000), 30);
});

test("small drift is bounded; large corrections cannot repeatedly skip", () => {
  assert.equal(driftCorrection({ actual: 1, expected: 1.05 }).type, "none");
  assert.equal(driftCorrection({ actual: 1, expected: 1.5 }).type, "rate");
  assert.equal(driftCorrection({ actual: 1, expected: 20 }).type, "seek");
  assert.equal(driftCorrection({ actual: 1, expected: 20, sinceCorrectionMs: 200 }).type, "rate");
  assert.ok(driftCorrection({ actual: 1, expected: 20, sinceCorrectionMs: 200 }).rate <= 1.02);
  assert.equal(driftCorrection({ actual: 1, expected: 1.4, uncertaintyMs: 500 }).type, "none");
});

test("duplicates/out-of-order packets are ignored; a gap reconciles current identity", () => {
  const current = { id: "session", sequence: 5, currentItemId: "track" };
  for (const sequence of [3, 5]) assert.equal(reconcileSnapshot(current, { ...current, sequence }).accept, false);
  const result = reconcileSnapshot(current, { ...current, sequence: 9 });
  assert.equal(result.accept, true);
  assert.equal(result.gap, true);
  assert.equal(result.sameMedia, true);
  assert.equal(reconcileSnapshot(current, { ...current, id: "other", sequence: 10 }).accept, false);
});
