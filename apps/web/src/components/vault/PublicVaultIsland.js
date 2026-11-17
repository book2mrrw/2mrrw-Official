"use client";

import { useEffect, useSyncExternalStore } from "react";
import { warmJson } from "@/lib/performance/context-warmup";
import { createPublicVaultStore } from "@/lib/storefront/public-vault-store";

// Shares warmJson's cache with the page's initial warmVault().
const publicVault = createPublicVaultStore(() => warmJson("/api/public/vault"));
const serverSnapshot = () => null;

/** Loads or revalidates the public Vault state; an unchanged answer re-renders nothing. */
export const loadPublicVault = () => publicVault.load();

/**
 * Render prop over the public Vault state: `children(publicVault)`. It loads
 * the state when the tab holding it is built — ahead of the visit, see
 * KeepAliveTab — so the tab is ready before it is opened.
 */
export default function PublicVaultIsland({ children }) {
  const state = useSyncExternalStore(publicVault.subscribe, publicVault.getSnapshot, serverSnapshot);
  useEffect(() => {
    void publicVault.load();
  }, []);
  return children(state);
}
