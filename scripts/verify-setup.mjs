import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "ADMIN_SEED_SECRET",
];

let failed = false;
for (const key of required) {
  if (!env[key]) {
    console.log(`ENV MISSING: ${key}`);
    failed = true;
  }
}

const siteUrl = env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_BASE_URL;
if (!siteUrl) {
  console.log("ENV WARN: set NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_BASE_URL");
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const tables = ["profiles", "products", "purchases", "library_items", "access_tokens"];
for (const t of tables) {
  const { error } = await admin.from(t).select("*", { count: "exact", head: true });
  console.log(`table ${t}:`, error ? `FAIL ${error.message}` : "OK");
  if (error) failed = true;
}

const { count, error: pErr } = await admin.from("products").select("slug", { count: "exact" });
if (pErr) {
  console.log("products query:", pErr.message);
  failed = true;
} else {
  console.log(`products_count: ${count}`);
  if (count === 0) {
    console.log("SEED NEEDED: run POST /api/admin/seed-products");
  }
}

const { data: buckets } = await admin.storage.listBuckets();
const hasAssets = buckets?.some((b) => b.name === "digital-assets");
console.log(`storage digital-assets: ${hasAssets ? "OK" : "MISSING (create private bucket)"}`);

if (!env.STRIPE_WEBHOOK_SECRET) {
  console.log("ENV WARN: STRIPE_WEBHOOK_SECRET not set (webhooks will fail)");
}

process.exit(failed ? 1 : 0);
