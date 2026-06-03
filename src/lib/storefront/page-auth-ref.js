"use client";

/**
 * Phase R1 — imperative auth snapshot for Page shell callbacks without useAuth()
 * subscription on PageStorefront (avoids full-tree reconcile on bootstrap).
 */

const EMPTY_AUTH_REF = {
  currentUser: null,
  library: [],
  accountState: null,
  membership: null,
  sessionHydrated: false,
  loading: true,
  owns: () => false,
  signOut: async () => {},
  refreshLibrary: async () => {},
  refreshAccountState: async () => {},
  invalidateEntitlementSnapshot: () => {},
};

/** @type {{ current: typeof EMPTY_AUTH_REF }} */
export const pageAuthRef = { current: EMPTY_AUTH_REF };

export function getPageAuthRef() {
  return pageAuthRef.current;
}

/**
 * @param {Partial<typeof EMPTY_AUTH_REF> & Record<string, unknown>} snapshot
 */
export function setPageAuthRef(snapshot) {
  pageAuthRef.current = { ...EMPTY_AUTH_REF, ...snapshot };
}
