import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// ── onPlay analytics guard (play-count contamination fix) ──────────────────

test("onPlay never persists a raw 'play' event for a preview-only track", () => {
  const src = read("src/lib/playback/PlaybackEventHandlers.js");
  const fnAt = src.indexOf("const onPlay = () => {");
  const nextFnAt = src.indexOf("\n  const onPause", fnAt) > -1 ? src.indexOf("\n  const onPause", fnAt) : src.length;
  const body = src.slice(fnAt, nextFnAt > fnAt ? nextFnAt : fnAt + 4000);
  const guardAt = body.indexOf("const analyticsAccess = stateRef.current.currentTrack?.metadata?.access;");
  const ifAt = body.indexOf("if (!analyticsAccess?.previewOnly && !analyticsAccess?.admin)", guardAt);
  const persistAt = body.indexOf("persistPlayback(isFreshListenStart ? \"play\" : \"progress\")", ifAt);
  assert.ok(
    guardAt > -1 && ifAt > guardAt && persistAt > ifAt,
    "onPlay must read access off the current track and gate persistPlayback on !previewOnly && !admin, in that order"
  );
});

test("onPlay excludes admin sessions from analytics the same way it excludes preview, reusing the existing access.admin flag", () => {
  const src = read("src/lib/playback/PlaybackEventHandlers.js");
  const fnAt = src.indexOf("const onPlay = () => {");
  const body = src.slice(fnAt, fnAt + 4000);
  assert.match(body, /!analyticsAccess\?\.previewOnly && !analyticsAccess\?\.admin/,
    "admin exclusion must be part of the single boolean guard, not a separate branch that could be skipped");
  // access.admin is stamped by adminTrackAccess() in music-access.js — confirm that
  // producer still exists and still sets the flag this handler now depends on.
  const access = read("src/lib/music-access.js");
  assert.match(access, /admin:\s*true/, "adminTrackAccess() must still stamp access.admin — onPlay's admin exclusion depends on it");
});

test("a resume-after-pause (currentTime not near zero) is reported as 'progress', not a fresh 'play' — no new event type introduced", () => {
  const src = read("src/lib/playback/PlaybackEventHandlers.js");
  const fnAt = src.indexOf("const onPlay = () => {");
  const body = src.slice(fnAt, fnAt + 4000);
  assert.match(body, /const isFreshListenStart = \(audioRef\.current\?\.currentTime \|\| 0\) < 1;/);
  assert.match(body, /persistPlayback\(isFreshListenStart \? "play" : "progress"\)/,
    "resume must route through the existing 'progress' event type — already excluded from the plays count server-side — instead of a new type requiring a schema change");
});

test("full (non-preview, non-admin) playback is otherwise untouched by the guard — persistPlayback is still called synchronously from onPlay, not deferred or moved", () => {
  const src = read("src/lib/playback/PlaybackEventHandlers.js");
  const fnAt = src.indexOf("const onPlay = () => {");
  const body = src.slice(fnAt, fnAt + 4000);
  // Everything else onPlay already did (SM transition, keep-alive ping, progress raf,
  // media session update, local listening record) must remain reachable unconditionally —
  // only the analytics persistPlayback call was made conditional.
  assert.match(body, /playbackStateMachine\.transition\(PLAYBACK_ORCHESTRATION_EVENTS\.PLAY_SUCCESS\)/);
  assert.match(body, /startKeepAlivePing\(\)/);
  assert.match(body, /startProgressRaf\(\)/);
  assert.match(body, /recordLocalListening\(track,/);
  assert.match(body, /void updateMediaSession\(track, \{ playing: true \}\)/);
});

// ── purchase_items: per-item revenue attribution ────────────────────────────

test("allocatePurchaseItemPrices exists and is wired into both fulfillment entry points before entitlements are granted", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  assert.match(src, /function allocatePurchaseItemPrices\(items, totalAmountCents\)/);
  assert.match(src, /async function recordPurchaseItems\(admin, \{ purchaseId, items, totalAmountCents \}\)/);

  const checkoutFnAt = src.indexOf("export async function fulfillCheckoutSession");
  const checkoutGrantAt = src.indexOf("grantLibraryItems(", checkoutFnAt);
  const checkoutRecordAt = src.indexOf("await recordPurchaseItems(", checkoutFnAt);
  const checkoutPurchaseErrAt = src.indexOf("if (purchaseErr) throw purchaseErr;", checkoutFnAt);
  assert.ok(
    checkoutPurchaseErrAt > -1 && checkoutRecordAt > checkoutPurchaseErrAt && checkoutRecordAt < checkoutGrantAt,
    "fulfillCheckoutSession must record purchase_items after the purchase row exists and before entitlements are granted"
  );

  const intentFnAt = src.indexOf("export async function fulfillPaymentIntent");
  const intentGrantAt = src.indexOf("grantLibraryItems(", intentFnAt);
  const intentRecordAt = src.indexOf("await recordPurchaseItems(", intentFnAt);
  const intentPurchaseErrAt = src.indexOf("if (purchaseErr) throw purchaseErr;", intentFnAt);
  assert.ok(
    intentPurchaseErrAt > -1 && intentRecordAt > intentPurchaseErrAt && intentRecordAt < intentGrantAt,
    "fulfillPaymentIntent must record purchase_items after the purchase row exists and before entitlements are granted"
  );
});

test("both fulfillment paths pass the real Stripe-charged total, not the cart's list-price sum, into recordPurchaseItems", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const checkoutFnAt = src.indexOf("export async function fulfillCheckoutSession");
  const checkoutBody = src.slice(checkoutFnAt, src.indexOf("export async function fulfillPaymentIntent"));
  assert.match(checkoutBody, /const amountCents = session\.amount_total \?\? 0;/);
  assert.match(checkoutBody, /recordPurchaseItems\(admin, \{ purchaseId: purchase\.id, items, totalAmountCents: amountCents \}\)/);

  const intentFnAt = src.indexOf("export async function fulfillPaymentIntent");
  const intentBody = src.slice(intentFnAt);
  assert.match(intentBody, /const amountCents = paymentIntent\.amount_received \?\? paymentIntent\.amount;/,
    "fulfillPaymentIntent must extract a named amountCents (Stripe's actually-received amount) rather than inlining it only in the purchases upsert");
  assert.match(intentBody, /amount_cents: amountCents,/);
  assert.match(intentBody, /recordPurchaseItems\(admin, \{ purchaseId: purchase\.id, items, totalAmountCents: amountCents \}\)/);
});

test("allocatePurchaseItemPrices guarantees the allocated sum exactly equals the charged total via last-item remainder absorption", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("function allocatePurchaseItemPrices(items, totalAmountCents)");
  const body = src.slice(fnAt, fnAt + 1600);
  assert.match(body, /const isLast = i === list\.length - 1;/);
  assert.match(body, /unitPriceCents = Math\.max\(0, totalAmountCents - allocated\);/,
    "the last item must take whatever remains of the charged total, not its own proportional share, so rounding never leaves the sum short or over");
  assert.match(body, /unitPriceCents = Math\.round\(\(listPrices\[i\] \/ listTotal\) \* totalAmountCents\)/);
});

test("allocatePurchaseItemPrices falls back to an even split when no usable list-price data exists, rather than dropping items", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("function allocatePurchaseItemPrices(items, totalAmountCents)");
  const body = src.slice(fnAt, fnAt + 1600);
  assert.match(body, /No usable list-price data.*split evenly/i);
  assert.match(body, /unitPriceCents = Math\.floor\(totalAmountCents \/ list\.length\);/);
});

test("recordPurchaseItems is idempotent on webhook retries: delete-then-insert keyed by purchase_id", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("async function recordPurchaseItems(admin");
  const body = src.slice(fnAt, fnAt + 2200);
  const deleteAt = body.indexOf('admin.from("purchase_items").delete().eq("purchase_id", purchaseId)');
  const insertAt = body.indexOf('admin.from("purchase_items").insert(rows)');
  assert.ok(deleteAt > -1 && insertAt > deleteAt, "a retry of the same webhook must replace, not duplicate, this purchase's line items");
});

test("recordPurchaseItems failures are logged and swallowed, never thrown — a revenue-reporting gap must not block entitlement granting", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("async function recordPurchaseItems(admin");
  const body = src.slice(fnAt, fnAt + 2200);
  assert.match(body, /try \{/);
  assert.match(body, /\} catch \(err\) \{\s*console\.warn\(/,
    "the catch block must warn, not rethrow — recordPurchaseItems runs before the entitlement-granting Promise.all in both callers");
  const catchAt = body.indexOf("} catch (err) {");
  const catchCloseAt = body.indexOf("\n  }\n}", catchAt);
  const catchBlock = body.slice(catchAt, catchCloseAt > -1 ? catchCloseAt : catchAt + 200);
  assert.doesNotMatch(catchBlock, /throw /, "no rethrow anywhere in the catch block");
});

test("recordPurchaseItems resolves product_id per slug via a single batch query, not one query per item", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("async function recordPurchaseItems(admin");
  const body = src.slice(fnAt, fnAt + 2200);
  assert.match(body, /admin\.from\("products"\)\.select\("id, slug"\)\.in\("slug", slugs\)/,
    "a single .in() query for all slugs — no per-item round trip to products");
});

// ── purchase_items migration schema ─────────────────────────────────────────

test("the purchase_items migration defines the columns and constraints the fulfillment code and revenue queries depend on", () => {
  const migrationsDir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.includes("purchase_items"));
  assert.equal(files.length, 1, "expected exactly one purchase_items migration");
  const sql = fs.readFileSync(path.join(migrationsDir, files[0]), "utf8");

  assert.match(sql, /create table if not exists public\.purchase_items/);
  assert.match(sql, /purchase_id\s+uuid\s+not null references public\.purchases\(id\) on delete cascade/,
    "purchase_items must cascade-delete with its parent purchase — no orphaned revenue rows");
  assert.match(sql, /product_id\s+uuid\s+references public\.products\(id\) on delete set null/,
    "a deleted product must not take its historical revenue rows down with it");
  assert.match(sql, /unit_price_cents\s+integer\s+not null check \(unit_price_cents >= 0\)/);
  assert.match(sql, /product_slug\s+text\s+not null/);
  assert.match(sql, /create index if not exists purchase_items_purchase_id_idx/);
  assert.match(sql, /create index if not exists purchase_items_product_slug_idx/);
});

// ── confirm full playback's own event path is untouched ─────────────────────

test("the full-playback pause/progress/complete persistPlayback call sites are unmodified — only onPlay's 'play' path was guarded", () => {
  const src = read("src/lib/playback/PlaybackEventHandlers.js");
  assert.match(src, /persistPlayback\("pause"\)/);
  assert.match(src, /persistPlayback\("progress"\)/);
  assert.match(src, /persistPlayback\("complete"\)/);
  // persistPlayback itself — the shared write path — must remain byte-for-byte
  // untouched: still a straight fetch with no new access-based branching inside it.
  const fnAt = src.indexOf("const persistPlayback = (eventType");
  const body = src.slice(fnAt, fnAt + 1200);
  assert.doesNotMatch(body, /previewOnly|\.admin/,
    "the analytics guard belongs at each call site (onPlay), not inside the shared persistPlayback helper");
});
