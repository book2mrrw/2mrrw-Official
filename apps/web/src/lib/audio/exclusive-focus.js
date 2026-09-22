// One tab-level lease, independent of React, routes, and the personal queue.
const KEY = Symbol.for("2mrrw.exclusiveAudioFocus");
const state = () => (globalThis[KEY] ||= { generation: 0, lease: null });

export function hasExclusiveAudioFocus() { return state().lease !== null; }

export function acquireExclusiveAudioFocus(owner) {
  const s = state();
  if (s.lease) throw new Error("An exclusive listening session is already active");
  const generation = ++s.generation;
  const lease = {
    owner,
    isCurrent: () => s.lease === lease && s.generation === generation,
    release: () => { if (lease.isCurrent()) { s.lease = null; s.generation++; return true; } return false; },
  };
  s.lease = lease;
  return lease;
}
