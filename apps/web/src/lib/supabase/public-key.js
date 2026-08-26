/** Browser-safe Supabase API credential. Prefer the rotatable publishable key. */
export const SUPABASE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
