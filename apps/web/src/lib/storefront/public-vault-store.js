/**
 * The public Vault state (/api/public/vault) shown by the Vault and Inner
 * Circle tabs. It lives outside the page component so its arrival re-renders
 * only those tabs' content, and a revalidation that returns the same answer
 * changes nothing at all.
 */
export function createPublicVaultStore(fetchState) {
  let snapshot = null;
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    /** Loads (or revalidates) the state; listeners hear only a real change. */
    load() {
      return Promise.resolve(fetchState()).then((payload) => {
        if (!payload || JSON.stringify(payload) === JSON.stringify(snapshot)) return;
        snapshot = payload;
        listeners.forEach((listener) => listener());
      });
    },
  };
}
