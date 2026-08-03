"use client";

import { accountStateShallowEqual } from "@/lib/auth/state-equality";

/**
 * Phase P9 — card chrome (entitlement/admin) isolated from media row reconcile.
 * Updated imperatively; only chrome leaves subscribe.
 */

const EMPTY_ENTITLEMENT_ACCOUNT_STATE = {
  library: [],
  ownedSlugs: [],
  subscriberActive: false,
  collectorCard: false,
  vaultAccess: false,
  membership: null,
  collectorOwnerships: [],
  mediaProgress: [],
  permissions: {},
  vaultAccessDetail: null,
  user: null,
  isAdmin: false,
};

const EMPTY_CHROME = Object.freeze({
  entitlementAccountState: EMPTY_ENTITLEMENT_ACCOUNT_STATE,
  userId: null,
  isAdminStable: false,
});

let chrome = EMPTY_CHROME;
const listeners = new Set();

export function getStorefrontCardChrome() {
  return chrome;
}

export function commitStorefrontCardChrome(next) {
  const entitlementAccountState =
    next?.entitlementAccountState ?? EMPTY_ENTITLEMENT_ACCOUNT_STATE;
  const userId = next?.userId ?? null;
  const isAdminStable = Boolean(next?.isAdminStable);

  if (
    chrome.userId === userId &&
    chrome.isAdminStable === isAdminStable &&
    accountStateShallowEqual(chrome.entitlementAccountState, entitlementAccountState)
  ) {
    return;
  }

  chrome = {
    entitlementAccountState,
    userId,
    isAdminStable,
  };
  listeners.forEach((listener) => listener());
}

export function subscribeStorefrontCardChrome(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
