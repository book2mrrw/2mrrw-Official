const FIRST_LISTEN_KEY = "2mrrw_first_listens";

export function isFirstListen(slug) {
  if (!slug || typeof window === "undefined") return false;
  try {
    const store = JSON.parse(localStorage.getItem(FIRST_LISTEN_KEY) || "{}");
    return !store[slug];
  } catch {
    return false;
  }
}

export function markListened(slug) {
  if (!slug || typeof window === "undefined") return;
  try {
    const store = JSON.parse(localStorage.getItem(FIRST_LISTEN_KEY) || "{}");
    store[slug] = Date.now();
    localStorage.setItem(FIRST_LISTEN_KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota */
  }
}
