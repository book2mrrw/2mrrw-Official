"use client";

import { useSyncExternalStore } from "react";
import {
  getStorefrontCardChrome,
  subscribeStorefrontCardChrome,
} from "@/lib/storefront/storefront-card-chrome-store";

/** Phase P9 — entitlement/admin chrome for storefront cards only. */
export function useStorefrontCardChrome() {
  return useSyncExternalStore(
    subscribeStorefrontCardChrome,
    getStorefrontCardChrome,
    getStorefrontCardChrome
  );
}
