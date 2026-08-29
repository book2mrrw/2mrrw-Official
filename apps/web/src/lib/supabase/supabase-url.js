const LEADING_INVISIBLE_CHARACTERS = /^[\uFEFF\u200B-\u200D\u2060]+/u;

/**
 * Vercel and copied env files can preserve a UTF-8 BOM or zero-width prefix.
 * Normalize once so every Supabase client receives the same valid origin.
 */
export function normalizeSupabaseUrl(value) {
  return String(value || "")
    .replace(LEADING_INVISIBLE_CHARACTERS, "")
    .trim()
    .replace(/\/+$/, "");
}

export const SUPABASE_URL = normalizeSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL
);
