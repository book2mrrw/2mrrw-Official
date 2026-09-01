const VERSION = "v1";
const PREFIX = "2mrrw:recovery:";

export { VERSION };

export function save(key, value) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ v: VERSION, data: value }));
  } catch {
    /* quota */
  }
}

export function load(key) {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== VERSION) {
      clear();
      return null;
    }
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function clear() {
  if (typeof sessionStorage === "undefined") return;
  const keys = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  keys.forEach((k) => sessionStorage.removeItem(k));
}
