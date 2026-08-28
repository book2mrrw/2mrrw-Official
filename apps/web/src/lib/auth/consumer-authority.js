import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Canonical server-side consumer authority.
 * Cookie payloads, React state, legacy guests, and profile roles are not
 * authority; Supabase Auth re-verifies the principal for every decision.
 */
export function isRegisteredConsumerPrincipal(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  return Boolean(user?.id && email && !email.endsWith("@guest.2mrrw.local"));
}

export async function requireConsumerPrincipal() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !isRegisteredConsumerPrincipal(data?.user)) return null;
    return data.user;
  } catch {
    return null;
  }
}
