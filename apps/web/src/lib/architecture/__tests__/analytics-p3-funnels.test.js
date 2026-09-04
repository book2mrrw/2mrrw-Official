import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migrationsDir = path.join(root, "supabase/migrations");
const readOnlyMigration = (needle) => {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.includes(needle));
  assert.equal(files.length, 1, `expected exactly one migration matching "${needle}"`);
  return fs.readFileSync(path.join(migrationsDir, files[0]), "utf8");
};

// ── attribution capture: client cookie, never a network call ───────────────

test("MarketingAttributionCapture only ever writes a cookie — no fetch/XHR, so it can never fail or block a page load", () => {
  const src = read("src/components/system/MarketingAttributionCapture.js");
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest/, "must be purely a client-side cookie write, no network call");
  assert.match(src, /if \(hasCookie\(COOKIE_NAME\)\) return;/, "must never overwrite an existing first-touch cookie");
});

test("attribution capture records nothing when there's no UTM param and no external referrer — stays undecided rather than stamping a noisy empty payload", () => {
  const src = read("src/components/system/MarketingAttributionCapture.js");
  assert.match(src, /if \(!Object\.keys\(utm\)\.length && !referrer\) return;/);
});

test("a same-origin referrer (internal navigation) is not recorded as an external referrer", () => {
  const src = read("src/components/system/MarketingAttributionCapture.js");
  assert.match(src, /document\.referrer && !document\.referrer\.startsWith\(window\.location\.origin\)/);
});

test("MarketingAttributionCapture is mounted once at the root layout, so it fires on every entry page, not just the homepage", () => {
  const src = read("src/app/layout.js");
  assert.match(src, /import MarketingAttributionCapture from "@\/components\/system\/MarketingAttributionCapture";/);
  const bodyAt = src.indexOf("<body");
  const mountAt = src.indexOf("<MarketingAttributionCapture", bodyAt);
  assert.ok(bodyAt > -1 && mountAt > bodyAt, "must be mounted inside <body>, not conditionally deep in a route tree");
});

// ── attribution-cookie.js: defensive read, matches codebase cookie convention ──

test("readAttributionCookie uses next/headers cookies(), matching every other cookie read in this codebase, not the request object directly", () => {
  const src = read("src/lib/auth/attribution-cookie.js");
  assert.match(src, /import \{ cookies \} from "next\/headers";/);
  assert.match(src, /const store = await cookies\(\);/);
});

test("readAttributionCookie is defensive against malformed or oversized cookie content — a client-writable cookie must never crash the signup path", () => {
  const src = read("src/lib/auth/attribution-cookie.js");
  const fnAt = src.indexOf("export async function readAttributionCookie");
  const body = src.slice(fnAt, fnAt + 900);
  assert.match(body, /\} catch \{\s*return null;\s*\}/);
  assert.match(body, /value\.slice\(0, 300\)/, "each field must be length-capped before it ever reaches a jsonb column");
  assert.match(body, /if \(!parsed \|\| typeof parsed !== "object"\) return null;/);
});

test("only an explicit allowlist of keys can reach profiles.first_touch — arbitrary cookie content can't inject unexpected jsonb keys", () => {
  const src = read("src/lib/auth/attribution-cookie.js");
  assert.match(src, /const ALLOWED_KEYS = \["source", "medium", "campaign", "term", "content", "referrer", "landingPath", "capturedAt"\];/);
});

// ── write-path wiring: both signup flows stamp first_touch at creation time ──

test("both account-creation routes read the attribution cookie and include first_touch directly in the initial profile insert — no extra write call needed", () => {
  for (const routeFile of ["src/app/api/auth/signup/route.js", "src/app/api/gifts/claim-signup/route.js"]) {
    const src = read(routeFile);
    assert.match(src, /import \{ readAttributionCookie \} from "@\/lib\/auth\/attribution-cookie";/, `${routeFile} must import the cookie reader`);
    const readAt = src.indexOf("const firstTouch = await readAttributionCookie();");
    const provisionAt = src.indexOf("persistNewUserProfileOrRollback(admin,", readAt);
    const fieldAt = src.indexOf("first_touch: firstTouch,", provisionAt);
    assert.ok(readAt > -1 && provisionAt > readAt && fieldAt > provisionAt,
      `${routeFile} must read the cookie before provisioning and pass it as first_touch on the same profile object`);
  }
});

// ── migration schema ─────────────────────────────────────────────────────

test("profiles gains a nullable first_touch jsonb column", () => {
  const sql = readOnlyMigration("attribution_and_funnels");
  assert.match(sql, /alter table public\.profiles\s*\n\s*add column if not exists first_touch jsonb;/);
});

test("get_funnel_stats computes signups -> streamed -> purchased purely from existing tables, no new event-logging table", () => {
  const sql = readOnlyMigration("attribution_and_funnels");
  const fnAt = sql.indexOf("create or replace function public.get_funnel_stats");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));
  assert.match(body, /from public\.media_stream_events\s*\n\s*where event_type = 'play' and user_id is not null/);
  assert.match(body, /from public\.purchases\s*\n\s*where status = 'completed'/);
  assert.match(body, /count\(\*\) filter \(where p\.created_at >= since\) as signups/);
});

test("get_cohort_retention buckets profiles by signup month and excludes month_offset rows that haven't happened yet", () => {
  const sql = readOnlyMigration("attribution_and_funnels");
  const fnAt = sql.indexOf("create or replace function public.get_cohort_retention");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));
  assert.match(body, /date_trunc\('month', created_at\) as cohort_month/);
  assert.match(body, /where c\.cohort_month \+ \(o\.month_offset \|\| ' months'\)::interval <= date_trunc\('month', now\(\)\)/,
    "a cohort can't yet have retention data for a month that hasn't happened");
});

test("get_attribution_breakdown buckets missing first_touch under 'direct'/'none' rather than dropping those signups from totals", () => {
  const sql = readOnlyMigration("attribution_and_funnels");
  const fnAt = sql.indexOf("create or replace function public.get_attribution_breakdown");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));
  assert.match(body, /coalesce\(first_touch->>'source', 'direct'\) as source/);
  assert.match(body, /coalesce\(first_touch->>'medium', 'none'\) as medium/);
});

test("all three new RPCs are granted to service_role", () => {
  const sql = readOnlyMigration("attribution_and_funnels");
  assert.match(sql, /grant execute on function public\.get_funnel_stats\(timestamptz\) to service_role;/);
  assert.match(sql, /grant execute on function public\.get_cohort_retention\(int\) to service_role;/);
  assert.match(sql, /grant execute on function public\.get_attribution_breakdown\(timestamptz\) to service_role;/);
});

// ── /api/admin/analytics/funnels route ──────────────────────────────────────

test("the funnels route is admin-gated under its own rate-limit key and calls all three RPCs in parallel", () => {
  const src = read("src/app/api/admin/analytics/funnels/route.js");
  assert.match(src, /if \(!user \|\| !isAdminUser\(user\)\) \{\s*return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/);
  assert.match(src, /routeKey: "admin\.analytics\.funnels",/);
  assert.match(src, /admin\.rpc\("get_funnel_stats", \{ since: ninetyDaysAgo \}\)\.maybeSingle\(\)/);
  assert.match(src, /admin\.rpc\("get_cohort_retention", \{ months_back: 6 \}\)/);
  assert.match(src, /admin\.rpc\("get_attribution_breakdown", \{ since: ninetyDaysAgo \}\)/);
});

// ── Funnels UI tab: additive, lazy, isolated from the other tabs ───────────

test("the Funnels tab is added without touching the other tab definitions, and fetches lazily only once opened", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const tabsAt = src.indexOf("const TABS = [");
  const tabsBody = src.slice(tabsAt, src.indexOf("];", tabsAt));
  assert.match(tabsBody, /\{ id:"funnels",  label:"Funnels"  \}/);

  assert.match(src, /const \[funnelsData,\s+setFunnelsData\]\s+= useState\(null\);/);
  const effectAt = src.indexOf('if (tab==="funnels" && !funnelsData && !funnelsLoading) loadFunnels();');
  assert.ok(effectAt > -1, "funnels must fetch only when its own tab is opened, matching the Revenue tab's lazy pattern");
});

test("FunnelsTab renders the acquisition funnel with step-over-step conversion percentages", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const fnAt = src.indexOf("function FunnelsTab(");
  const body = src.slice(fnAt, fnAt + 2500);
  assert.match(body, /const convPct = prev \? Math\.round\(\(s\.value\/prev\)\*100\) : 100;/);
});

test("FunnelsTab renders a cohort retention grid keyed by (cohortMonth, monthOffset) with no crash on an empty cohort list", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const fnAt = src.indexOf("function FunnelsTab(");
  const body = src.slice(fnAt, fnAt + 5000);
  assert.match(body, /cohortMonths\.length===0 \? \(/);
  assert.match(body, /const cellFor = \(month, offset\) => cohorts\.find\(c=>c\.cohortMonth===month && c\.monthOffset===offset\);/);
});
