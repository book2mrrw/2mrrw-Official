/**
 * PRINCIPAL DEPENDENCY SWEEP — the migration engine's inventory.
 *
 *   INV-ID-MIG-1  A principal cannot be merged, retired, or deleted until every
 *                 database object referencing that principal identity has been
 *                 enumerated and classified.
 *   INV-ID-MIG-2  A successful merge requires ZERO residual references to the
 *                 source principal across the complete dependency graph.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A migration was scoped by hand against three "important" tables:
 * library_items, purchases, gift_redemptions. It missed `entitlements` and
 * `gifts.recipient_id`. Running it would have reassigned a principal's library
 * while leaving its entitlement rows behind — a silent split-brain identity,
 * where the same human owns content under two ids and neither view is complete.
 *
 * A hand-picked list cannot be trusted for this. The inventory below is
 * MACHINE-GENERATED from the migration SQL: every `references auth.users`
 * foreign key is parsed out, along with its ON DELETE behaviour, which is what
 * decides whether a row is reassignable, cascades away, or survives anonymised.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   node principal-dependency-sweep.mjs --inventory
 *   node principal-dependency-sweep.mjs --audit <principalId> [<principalId>...]
 *   node principal-dependency-sweep.mjs --audit-guests
 *
 * Read-only. It never mutates. Mutation belongs to the caller, which must first
 * pass an audit showing it understands every surface it is about to touch.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!URL_BASE || !SERVICE) {
  console.error("\n  ABORT: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required\n");
  process.exit(2);
}
const db = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

const MIGRATIONS = path.resolve(import.meta.dirname, "../migrations");

/**
 * Parse every foreign key to auth.users out of the migration SQL.
 *
 * Returns [{ table, column, onDelete }]. `onDelete` is load-bearing:
 *
 *   cascade    row dies with the principal — reassign BEFORE deleting or it is lost
 *   set null   row survives, attribution erased — stamp provenance first if it matters
 *   (none)     delete is BLOCKED by the constraint until the row is handled
 */
function buildInventory() {
  const found = new Map();
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");

    // Track the table each column definition belongs to.
    const tableRe = /create table if not exists\s+(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\);/gi;
    let t;
    while ((t = tableRe.exec(sql))) {
      const table = t[1];
      const body = t[2];
      const colRe =
        /^\s*([a-z0-9_]+)\s+uuid[^,\n]*references\s+auth\.users\s*\(\s*id\s*\)([^,\n]*)/gim;
      let c;
      while ((c = colRe.exec(body))) {
        const column = c[1];
        const tail = (c[2] || "").toLowerCase();
        const onDelete = tail.includes("on delete cascade")
          ? "cascade"
          : tail.includes("on delete set null")
            ? "set null"
            : "restrict";
        found.set(`${table}.${column}`, { table, column, onDelete, source: file });
      }
    }

    // alter table ... add column ... references auth.users
    const alterRe =
      /alter table\s+(?:public\.)?([a-z0-9_]+)\s+add column(?: if not exists)?\s+([a-z0-9_]+)\s+uuid[^;]*references\s+auth\.users\s*\(\s*id\s*\)([^;]*)/gi;
    let a;
    while ((a = alterRe.exec(sql))) {
      const tail = (a[3] || "").toLowerCase();
      found.set(`${a[1]}.${a[2]}`, {
        table: a[1],
        column: a[2],
        onDelete: tail.includes("on delete cascade")
          ? "cascade"
          : tail.includes("on delete set null")
            ? "set null"
            : "restrict",
        source: file,
      });
    }
  }
  return [...found.values()].sort((x, y) => `${x.table}.${x.column}`.localeCompare(`${y.table}.${y.column}`));
}

/**
 * Probe the live database for reference columns the SQL parse could not see —
 * tables created out of band (the OPS-01 class of problem, as login_otp was).
 *
 * The parse is authoritative for what SHOULD exist; this catches what DOES.
 */
async function probeLive(inventory) {
  const known = new Set(inventory.map((i) => `${i.table}.${i.column}`));
  const candidates = new Set();
  for (const { table } of inventory) candidates.add(table);
  for (const t of [
    "profiles", "purchases", "library_items", "entitlements", "gifts", "gift_redemptions",
    "user_entitlements", "collector_ownerships", "memberships", "notification_inbox",
    "notification_preferences", "media_playback_progress", "media_stream_events",
    "user_playlists", "user_playback_queue", "vault_content_progress", "admin_principals",
    "access_tokens", "ticket_purchases", "circle_posts", "community_comments",
  ]) candidates.add(t);

  // `id` is deliberately excluded: it is every table's own primary key, so
  // probing it reports a "reference" for all of them. The one genuine case,
  // profiles.id, is already declared in the migrations and parsed above.
  // A probe that flags everything teaches the reader to ignore it.
  const PRINCIPAL_COLUMNS = [
    "user_id", "recipient_id", "sender_id", "owner_id", "granted_by",
    "gifted_by", "claimed_by_user_id", "purchaser_user_id", "updated_by",
    "created_by", "actor_id", "author_id",
  ];

  const extra = [];
  for (const table of candidates) {
    for (const column of PRINCIPAL_COLUMNS) {
      if (known.has(`${table}.${column}`)) continue;
      const { error } = await db.from(table).select(column).limit(1);
      if (!error) extra.push({ table, column, onDelete: "unknown (live probe)", source: "live" });
    }
  }
  return extra;
}

/**
 * Classification — the second half of INV-ID-MIG-1. Enumeration alone does not
 * support a decision: `profiles.id` cascading away with a principal is correct,
 * while `library_items.user_id` cascading away destroys an entitlement someone
 * paid for. The delete verdict depends on WHAT a reference means, not how many.
 *
 *   VALUE       ownership, money, entitlement. Must be reassigned before any
 *               delete, or value is destroyed. Blocks deletion outright.
 *   HISTORICAL  immutable measurement. Survives via `set null`; stamp provenance
 *               first if attribution is to be kept.
 *   STATE       per-account working state, meaningless without a live account.
 *               Safe to let cascade.
 *   DERIVED     bookkeeping that exists only because the principal did.
 *               Safe to let cascade.
 */
const CLASS = {
  VALUE: [
    "library_items.user_id", "purchases.user_id", "entitlements.user_id",
    "user_entitlements.user_id", "vault_entitlements.user_id", "gift_redemptions.user_id",
    "gifts.recipient_id", "collector_ownerships.user_id", "collector_claims.user_id",
    "collector_access.user_id", "memberships.user_id", "ticket_purchases.user_id",
    "gift_transactions.purchaser_user_id", "access_tokens.user_id",
    "stripe_customers.user_id", "admin_principals.user_id",
  ],
  HISTORICAL: [
    "media_stream_events.user_id", "stream_events.user_id", "stream_sessions.user_id",
    "collector_activity_logs.user_id", "event_checkins.user_id", "circle_posts.user_id",
    "circle_replies.user_id", "circle_reactions.user_id", "community_comments.user_id",
    "gifts.sender_id", "library_items.gifted_by", "purchases.gifted_by",
    "admin_principals.granted_by", "ownership_authority_state.updated_by",
    "collector_cards.claimed_by_user_id",
  ],
  STATE: [
    "media_playback_progress.user_id", "vault_content_progress.user_id",
    "user_playback_queue.user_id", "user_playlists.user_id",
    "signal_user_states.user_id", "login_otp.user_id",
  ],
};
function classify(key) {
  for (const [name, list] of Object.entries(CLASS)) if (list.includes(key)) return name;
  return "DERIVED";
}

async function audit(inventory, ids) {
  const perPrincipal = new Map(ids.map((id) => [id, new Map()]));
  for (const entry of inventory) {
    const { table, column } = entry;
    const { data, error } = await db.from(table).select(column).in(column, ids);
    if (error) continue;
    for (const row of data || []) {
      const id = row[column];
      if (!perPrincipal.has(id)) continue;
      const key = `${table}.${column}`;
      const bucket = perPrincipal.get(id);
      bucket.set(key, { ...entry, key, klass: classify(key), count: (bucket.get(key)?.count || 0) + 1 });
    }
  }
  return perPrincipal;
}

const arg = process.argv[2];

if (arg === "--inventory") {
  const inv = buildInventory();
  console.log(`\n  DEPENDENCY INVENTORY — ${inv.length} declared FKs to auth.users\n`);
  console.log("  on-delete   table.column");
  console.log("  ----------  --------------------------------------------------");
  for (const i of inv) console.log(`  ${i.onDelete.padEnd(10)}  ${i.table}.${i.column}`);

  const extra = await probeLive(inv);
  if (extra.length) {
    console.log(`\n  LIVE-ONLY reference columns not declared in migrations (${extra.length}):`);
    for (const e of extra) console.log(`  ${"—".padEnd(10)}  ${e.table}.${e.column}`);
    console.log("\n  These are the OPS-01 class: present in the database, absent from source.");
  }
  console.log("");
  process.exit(0);
}

if (arg === "--audit" || arg === "--audit-guests") {
  const inv = [...buildInventory(), ...(await probeLive(buildInventory()))];
  let ids = process.argv.slice(3);
  const labels = {};

  if (arg === "--audit-guests") {
    const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const guests = (data?.users || []).filter((u) => String(u.email || "").endsWith("@guest.2mrrw.local"));
    ids = guests.map((g) => g.id);
    for (const g of guests) labels[g.id] = g.user_metadata?.contact_email || "(no contact)";
  }
  if (!ids.length) {
    console.error("  ABORT: no principal ids supplied");
    process.exit(2);
  }

  const result = await audit(inv, ids);
  console.log(`\n  PRINCIPAL AUDIT — ${ids.length} principal(s) against ${inv.length} reference columns\n`);

  const verdicts = { DELETABLE: [], TOMBSTONE: [], BLOCKED: [] };
  for (const [id, refMap] of result) {
    const label = labels[id] || id;
    const refs = [...refMap.values()].sort((a, b) => a.key.localeCompare(b.key));
    const value = refs.filter((r) => r.klass === "VALUE");
    const historical = refs.filter((r) => r.klass === "HISTORICAL");

    // The verdict, per INV-ID-MIG-1/2.
    const verdict = value.length ? "BLOCKED" : historical.length ? "TOMBSTONE" : "DELETABLE";
    verdicts[verdict].push(label);

    const tag =
      verdict === "BLOCKED" ? "BLOCKED  " : verdict === "TOMBSTONE" ? "TOMBSTONE" : "DELETABLE";
    console.log(`  ${tag} ${label}`);
    for (const r of refs) {
      console.log(
        `            ${r.klass.padEnd(11)}${r.onDelete.padEnd(10)}${r.key}  x${r.count}`
      );
    }
  }

  console.log("\n  ─────────────────────────────────────────────────────────────");
  console.log(`  DELETABLE  ${verdicts.DELETABLE.length}  no value, no history — cascades are safe`);
  console.log(`  TOMBSTONE  ${verdicts.TOMBSTONE.length}  historical rows survive; stamp provenance before deleting`);
  console.log(`  BLOCKED    ${verdicts.BLOCKED.length}  holds VALUE — must be reassigned first (INV-ID-MIG-2)`);
  console.log("\n  A principal is only deletable once every VALUE reference is zero.\n");
  process.exit(0);
}

console.error(`
  usage:
    --inventory                       machine-generated dependency graph
    --audit <id> [<id>...]            references held by specific principals
    --audit-guests                    references held by every legacy guest
`);
process.exit(2);
