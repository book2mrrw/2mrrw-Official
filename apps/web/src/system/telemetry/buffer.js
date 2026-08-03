const MAX_EVENTS = 500;

/** @type {unknown[]} */
const ring = [];

export function push(event) {
  ring.push(event);
  if (ring.length > MAX_EVENTS) ring.shift();
}

export function drain() {
  const out = [...ring];
  ring.length = 0;
  return out;
}

export function peek(n = 10) {
  return ring.slice(-n);
}

export function clear() {
  ring.length = 0;
}
