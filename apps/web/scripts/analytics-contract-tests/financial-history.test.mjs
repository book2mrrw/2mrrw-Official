import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
// PGlite is a pinned devDependency; PGLITE_MODULE can point at another build.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");

const migration = await fs.readFile(new URL("../../supabase/migrations/20261119230000_financial_history_append_only.sql", import.meta.url), "utf8");

// purchases / purchase_items as production had them on 2026-11-19 — including
// BOTH foreign keys on purchases.user_id (SET NULL and the stray CASCADE).
const PRODUCTION_BASELINE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.products (id uuid primary key default gen_random_uuid(), slug text unique, title text, release_id uuid);
  create table public.purchases (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, stripe_payment_intent_id text unique, stripe_checkout_session_id text unique,
    amount_cents integer check (amount_cents >= 0), currency text default 'usd',
    status text check (status = any (array['pending','completed','failed','refunded'])),
    items jsonb, receipt_url text, purchased_at timestamptz default now(), created_at timestamptz default now(),
    purchase_type text default 'purchase', gifted_by uuid, gift_id uuid, lifecycle_subject_ref text,
    shipping_address jsonb, shipping_rate_cents integer
  );
  -- Production order: the CASCADE key is older; the SET NULL key was dropped and
  -- re-created later (migration 20260823000045), so CASCADE's trigger fires first.
  alter table public.purchases add constraint purchases_user_id_fkey1 foreign key (user_id) references auth.users(id) on delete cascade;
  alter table public.purchases add constraint purchases_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;
  create table public.purchase_items (
    id uuid primary key default gen_random_uuid(),
    purchase_id uuid not null references public.purchases(id) on delete cascade,
    product_id uuid references public.products(id) on delete set null, product_slug text, title text,
    item_type text not null default 'digital' check (item_type in ('digital','merch','audio_visual')),
    access_type text, release_id uuid, unit_price_cents integer not null check (unit_price_cents >= 0),
    quantity integer not null default 1 check (quantity > 0), created_at timestamptz not null default now(),
    variant_id uuid, audio_visual_id uuid,
    check (product_slug is not null or audio_visual_id is not null)
  );`;

const FAN = "f0000000-0000-4000-8000-000000000001";

async function fresh() {
  const db = new PGlite();
  await db.exec(PRODUCTION_BASELINE);
  await db.exec(`
    insert into auth.users values ('${FAN}');
    insert into public.products (slug, title) values ('w2d', 'W2D'), ('tbh', 'TBH');
    -- the one historical paid sale: two items, 299 cents, before purchase_items existed
    insert into public.purchases (id, user_id, stripe_payment_intent_id, amount_cents, status, items, purchased_at)
      values ('a0000000-0000-4000-8000-000000000001', '${FAN}', 'pi_old', 299, 'completed',
              '[{"slug":"w2d","title":"W2D"},{"slug":"tbh","title":"TBH"}]', '2026-05-21T12:00:00Z');
    -- a gift and a free claim: no money, no line items
    insert into public.purchases (user_id, amount_cents, status, items, purchase_type) values
      ('${FAN}', 0, 'completed', '[{"slug":"w2d"}]', 'gift'),
      ('${FAN}', 0, 'completed', '[{"slug":"w2d"}]', 'purchase');
  `);
  await db.exec(migration);
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  return { db, one };
}

test("the historical paid sale gets its line items; gifts and free claims get none", async () => {
  const { db } = await fresh();
  const items = (await db.query("select product_slug, unit_price_cents from public.purchase_items order by unit_price_cents desc")).rows;
  assert.deepEqual(items.map((i) => [i.product_slug, i.unit_price_cents]), [["w2d", 150], ["tbh", 149]], "split evenly, remainder cent on the first item");
});

test("deleting a user keeps their purchases (the stray CASCADE key is gone)", async () => {
  const { db, one } = await fresh();
  await db.query("delete from auth.users where id = $1", [FAN]);
  const r = await one("select count(*)::int n, count(user_id)::int with_user from public.purchases");
  assert.deepEqual(r, { n: 3, with_user: 0 });
  const cascading = await one(`select count(*)::int n from pg_constraint
    where conrelid = 'public.purchases'::regclass and contype = 'f' and confdeltype = 'c'`);
  assert.equal(cascading.n, 0, "no cascading key may remain on purchases");
});

test("a completed sale's amount, date and items cannot be rewritten; its status still can change", async () => {
  const { db, one } = await fresh();
  await db.query(`update public.purchases set amount_cents = 1, currency = 'eur', purchased_at = now(), items = '[]', status = 'refunded'
                  where stripe_payment_intent_id = 'pi_old'`);
  const p = await one("select amount_cents, currency, purchased_at, jsonb_array_length(items) n, status from public.purchases where stripe_payment_intent_id = 'pi_old'");
  assert.equal(p.amount_cents, 299);
  assert.equal(p.currency, "usd");
  assert.equal(new Date(p.purchased_at).toISOString(), "2026-05-21T12:00:00.000Z", "a webhook retry can no longer move the sale date");
  assert.equal(p.n, 2);
  assert.equal(p.status, "refunded");
});

test("a webhook-retry upsert keeps the original sale date and amount", async () => {
  const { db, one } = await fresh();
  await db.query(`insert into public.purchases (stripe_payment_intent_id, amount_cents, status, purchased_at)
                  values ('pi_old', 999, 'completed', now())
                  on conflict (stripe_payment_intent_id) do update set amount_cents = excluded.amount_cents, purchased_at = excluded.purchased_at, status = excluded.status`);
  const p = await one("select amount_cents, purchased_at from public.purchases where stripe_payment_intent_id = 'pi_old'");
  assert.equal(p.amount_cents, 299);
  assert.equal(new Date(p.purchased_at).toISOString(), "2026-05-21T12:00:00.000Z");
});

test("account anonymization still works on a completed sale", async () => {
  const { db, one } = await fresh();
  await db.query("update public.purchases set user_id = null, receipt_url = null, lifecycle_subject_ref = 'subj' where stripe_payment_intent_id = 'pi_old'");
  const p = await one("select user_id, lifecycle_subject_ref, amount_cents from public.purchases where stripe_payment_intent_id = 'pi_old'");
  assert.deepEqual([p.user_id, p.lifecycle_subject_ref, p.amount_cents], [null, "subj", 299]);
});

test("adjustments and line items are append-only; a refund is recorded once", async () => {
  const { db, one } = await fresh();
  const pid = "a0000000-0000-4000-8000-000000000001";
  const add = "insert into public.purchase_adjustments (purchase_id, kind, amount_cents, stripe_object_id, occurred_at) values ($1, 'refund', -299, 're_1', '2026-06-01') on conflict (kind, stripe_object_id) do nothing";
  await db.query(add, [pid]);
  await db.query(add, [pid]);
  assert.equal((await one("select count(*)::int n from public.purchase_adjustments")).n, 1);
  await assert.rejects(db.query("update public.purchase_adjustments set amount_cents = 0"), /append-only/);
  await assert.rejects(db.query("delete from public.purchase_adjustments"), /append-only/);
  await assert.rejects(db.query("delete from public.purchase_items"), /append-only/);
  await assert.rejects(db.query("update public.purchase_items set unit_price_cents = 0"), /append-only/);
  await assert.rejects(db.query("delete from public.purchases where id = $1", [pid]), "a sale with adjustments cannot be deleted");
});

test("revenue: a May sale refunded in June stays in May's gross and shows as a June refund", async () => {
  const { db, one } = await fresh();
  const pid = "a0000000-0000-4000-8000-000000000001";
  await db.query("insert into public.purchase_adjustments (purchase_id, kind, amount_cents, stripe_object_id, occurred_at) values ($1, 'refund', -299, 're_1', '2026-06-10')", [pid]);
  await db.query("update public.purchases set status = 'refunded' where id = $1", [pid]);
  const may = await one("select * from public.analytics_revenue_summary('2026-05-01', '2026-06-01')");
  assert.deepEqual([Number(may.gross_sales_cents), Number(may.refunds_cents), Number(may.net_cents), Number(may.paid_orders)], [299, 0, 299, 1]);
  const june = await one("select * from public.analytics_revenue_summary('2026-06-01', '2026-07-01')");
  assert.deepEqual([Number(june.gross_sales_cents), Number(june.refunds_cents), Number(june.net_cents)], [0, 299, -299]);
  const life = await one("select * from public.analytics_revenue_summary()");
  assert.deepEqual([Number(life.gross_sales_cents), Number(life.refunds_cents), Number(life.net_cents), Number(life.refunded_orders), Number(life.gifts)], [299, 299, 0, 1, 1]);
  const rel = (await db.query("select product_slug, gross_cents from public.get_release_revenue_stats('2026-01-01') order by gross_cents desc")).rows;
  assert.deepEqual(rel.map((r) => [r.product_slug, Number(r.gross_cents)]), [["w2d", 150], ["tbh", 149]], "a refunded sale stays in release gross for its sale period");
});

test("a won dispute returns the money: dispute out, reversal back in", async () => {
  const { db, one } = await fresh();
  const pid = "a0000000-0000-4000-8000-000000000001";
  await db.query("insert into public.purchase_adjustments (purchase_id, kind, amount_cents, stripe_object_id, occurred_at) values ($1,'dispute',-299,'du_1','2026-06-02'), ($1,'dispute_reversal',299,'du_1','2026-06-20')", [pid]);
  const june = await one("select * from public.analytics_revenue_summary('2026-06-01', '2026-07-01')");
  assert.equal(Number(june.disputes_cents), 0);
  assert.equal(Number(june.net_cents), 0);
});

test("the browser can neither read the ledger nor call the revenue function", async () => {
  const { one } = await fresh();
  for (const role of ["anon", "authenticated"]) {
    const r = await one(`select has_table_privilege('${role}', 'public.purchase_adjustments', 'select') sel,
      has_function_privilege('${role}', 'public.analytics_revenue_summary(timestamptz, timestamptz)', 'execute') fn`);
    assert.deepEqual([r.sel, r.fn], [false, false], role);
  }
});
