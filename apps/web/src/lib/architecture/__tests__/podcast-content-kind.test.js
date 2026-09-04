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

// ── schema: content_kind tags both releases and products ────────────────────

test("releases and products both gain a content_kind column defaulting to music", () => {
  const sql = readOnlyMigration("content_kind");
  assert.match(sql, /alter table public\.releases\s*\n\s*add column if not exists content_kind text not null default 'music'\s*\n\s*check \(content_kind in \('music', 'podcast'\)\);/);
  assert.match(sql, /alter table public\.products\s*\n\s*add column if not exists content_kind text not null default 'music'\s*\n\s*check \(content_kind in \('music', 'podcast'\)\);/);
});

// ── draft creation accepts and validates content_kind ────────────────────────

test("draft creation accepts a validated content_kind and defaults it to music for every pre-existing caller", () => {
  const src = read("src/app/api/admin/releases/draft/route.js");
  assert.match(src, /content_kind: contentKind = "music"/);
  assert.match(src, /VALID_CONTENT_KINDS = \["music", "podcast"\];/);
  assert.match(src, /if \(!VALID_CONTENT_KINDS\.includes\(contentKind\)\)/);
});

test("the draft insert persists content_kind and echoes it back on both the fresh and recovered-draft paths", () => {
  const src = read("src/app/api/admin/releases/draft/route.js");
  assert.match(src, /\.insert\(\{\s*\n\s*release_type,\s*\n\s*content_kind: contentKind,/);
  assert.match(src, /content_kind: data\.content_kind, recovered: false/);
  assert.match(src, /content_kind: existingDraft\.content_kind,\s*\n\s*recovered: true,/);
});

// ── publish carries content_kind from the release onto the product row ──────

test("publish selects content_kind from the release and stamps it onto the products upsert — the one place a podcast episode is tagged for storefront filtering", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /\.select\("id, slug, status, release_type, content_kind, cover_art_r2_key, metadata"\)/);
  assert.match(src, /content_kind:\s*release\.content_kind \|\| "music",/);
});

// ── storefront catalog queries exclude podcasts; the radio feed includes them ──

test("the two storefront shop/catalog reads exclude podcasts explicitly, not by accident of a shared filter", () => {
  const src = read("src/lib/media/catalog-db.js");
  const singlesPageAt = src.indexOf("export async function getStorefrontSinglesPageFromDB");
  const singlesPageBody = src.slice(singlesPageAt, singlesPageAt + 700);
  assert.match(singlesPageBody, /\.eq\("content_kind", "music"\)/);

  const catalogAt = src.indexOf("export async function getStorefrontCatalogFromDB");
  const catalogBody = src.slice(catalogAt, catalogAt + 700);
  assert.match(catalogBody, /\.eq\("content_kind", "music"\)/);
});

test("getRadioCarouselItemsFromDB is the one storefront read that deliberately includes both music and podcast content", () => {
  const src = read("src/lib/media/catalog-db.js");
  const fnAt = src.indexOf("export async function getRadioCarouselItemsFromDB");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 1600);
  assert.doesNotMatch(body, /\.eq\("content_kind"/,
    "the radio feed must not filter by content_kind — excluding podcasts here would defeat the entire feature");
  assert.match(body, /\.in\("product_type", \["single", "feature", "album"\]\)/);
  assert.match(body, /\.eq\("active", true\)/);
  assert.match(body, /const enriched = mapProductRow\(row\);/,
    "must reuse the canonical enrichment function, not a second parallel cover/preview resolver");
  assert.match(body, /const contentKind = row\.content_kind === "podcast" \? "podcast" : "music";/);
});

test("PRODUCT_COLS selects content_kind so mapProductRow-adjacent callers can read it off every row", () => {
  const src = read("src/lib/media/catalog-db.js");
  const colsAt = src.indexOf("const PRODUCT_COLS = [");
  const colsBody = src.slice(colsAt, src.indexOf("].join", colsAt));
  assert.match(colsBody, /"content_kind"/);
});

// ── the catalog API route exposes a radio view backed by that function ───────

test("view=radio calls getRadioCarouselItemsFromDB and returns an items array, distinct from the snapshot/platform views", () => {
  const src = read("src/app/api/catalog/releases/route.js");
  assert.match(src, /import \{[\s\S]*getRadioCarouselItemsFromDB,?[\s\S]*\} from "@\/lib\/media\/catalog-db";/);
  const radioAt = src.indexOf('if (view === "radio")');
  const platformAt = src.indexOf('if (view === "platform")');
  assert.ok(radioAt > -1 && platformAt > radioAt, "the radio branch must be a distinct, earlier check than platform");
  const radioBody = src.slice(radioAt, platformAt);
  assert.match(radioBody, /getRadioCarouselItemsFromDB\(\{ limit: 8 \}\)/);
  assert.match(radioBody, /items,/);
});

// ── HomeClient: the carousel is fed by a live fetch, not a frozen array ──────

test("radioSlidesData is real component state seeded by the fallback and replaced by a live /view=radio fetch, not a module-level constant", () => {
  const src = read("src/app/HomeClient.js");
  assert.match(src, /const RADIO_SLIDES_FALLBACK = \[/);
  assert.match(src, /const \[radioSlidesData, setRadioSlidesData\] = useState\(RADIO_SLIDES_FALLBACK\);/);
  const fetchAt = src.indexOf('fetch("/api/catalog/releases?view=radio")');
  assert.ok(fetchAt > -1);
  const fetchBody = src.slice(fetchAt, fetchAt + 400);
  assert.match(fetchBody, /setRadioSlidesData\(json\.items\);/);
});

test("enrichedRadioSlides is derived from the live radioSlidesData state, not the old frozen module-level array", () => {
  const src = read("src/app/HomeClient.js");
  assert.match(src, /const enrichedRadioSlides = useMemo\(\s*\n\s*\(\) => radioSlidesData\.map\(\(slide\) => enrichRadioSlide\(slide\)\),\s*\n\s*\[radioSlidesData, enrichRadioSlide\]/);
});

test("enrichRadioSlide prefers the live catalog match's cover/preview over the slide's own value — the merge-priority bug that made new/updated cover art invisible in the carousel", () => {
  const src = read("src/app/HomeClient.js");
  const fnAt = src.indexOf("const enrichRadioSlide = useCallback(");
  const body = src.slice(fnAt, fnAt + 900);
  assert.match(body, /cover: match\.cover \|\| slide\.cover,/);
  assert.match(body, /preview: match\.preview \|\| slide\.preview,/);
});

// ── RadioCarousel: the type/kind badge is real, not a hardcoded "SINGLE" ─────

test("RadioCarousel derives its type label from the actual item instead of a hardcoded SINGLE literal, and gives podcasts their own EPISODE/SERIES label", () => {
  const src = read("src/components/home/RadioCarousel.js");
  assert.doesNotMatch(src, />SINGLE<\//, "must not render a hardcoded SINGLE string regardless of the actual item");
  assert.match(src, /const RADIO_TYPE_LABELS = \{ single: "SINGLE", feature: "FEATURE", album: "ALBUM", ep: "EP", mixtape: "MIXTAPE" \};/);
  assert.match(src, /const kindLabel = currentSlide\.contentKind === "podcast"/);
  assert.match(src, /\{kindLabel\}/);
});

// ── UploadWizard: contentKind restricts the type picker and namespaces state ──

test("ReleaseTypeStep shows only the two podcast-shaped options (Single Episode / Multi-Episode Series) when contentKind is podcast, and the full 5-type list otherwise", () => {
  const src = read("src/components/admin/UploadWizard.js");
  const fnAt = src.indexOf('function ReleaseTypeStep({ data, onChange, onNext, loading, contentKind = "music" }) {');
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 900);
  assert.match(body, /label: "Single Episode",\s*desc: "One standalone episode"/);
  assert.match(body, /label: "Multi-Episode Series",\s*desc: "Several episodes released together"/);
  assert.match(body, /label: "Feature", desc: "Collab where 2MRRW is featured"/);
});

test("UploadWizard threads contentKind into the draft-creation request body and into every step via commonProps", () => {
  const src = read("src/components/admin/UploadWizard.js");
  assert.match(src, /export function UploadWizard\(\{ onComplete, onDismiss, initialReleaseId = null, contentKind = "music" \}\)/);
  assert.match(src, /body: JSON\.stringify\(\{\s*\n\s*release_type: data\.release_type,\s*\n\s*content_kind: contentKind,/);
  assert.match(src, /const commonProps = \{ data, onChange: setField, onNext: next, onBack: back, releaseId, draftSlug, contentKind \};/);
});

test("the upload session key is namespaced per contentKind so a podcast draft-in-progress can never resume as a music draft or vice versa", () => {
  const src = read("src/components/admin/UploadWizard.js");
  assert.match(src, /const sessionStorageKey = `2mrrw\.admin\.\$\{contentKind\}-upload`;/);
  const getAt = src.indexOf("sessionStorage.getItem(sessionStorageKey)");
  const setAt = src.indexOf("sessionStorage.setItem(sessionStorageKey,");
  const removeAt = src.indexOf("sessionStorage.removeItem(sessionStorageKey);");
  assert.ok(getAt > -1 && setAt > -1 && removeAt > -1);
});

// ── admin/upload page reads ?kind= and routes completion back to the right tab ──

test("the admin upload page reads ?kind= from the URL and routes onComplete/onDismiss back to the matching tab", () => {
  const src = read("src/app/admin/upload/page.js");
  assert.match(src, /setContentKind\(params\.get\("kind"\) === "podcast" \? "podcast" : "music"\);/);
  assert.match(src, /contentKind=\{contentKind\}/);
  assert.match(src, /onComplete=\{\(\) => router\.push\(contentKind === "podcast" \? "\/admin\/podcast" : "\/admin\/releases"\)\}/);
  assert.match(src, /onDismiss=\{\(\) => router\.push\(contentKind === "podcast" \? "\/admin\/podcast" : "\/admin"\)\}/);
});

// ── admin nav + list API kind filtering ──────────────────────────────────────

test("the admin dashboard has a dedicated Podcast nav tile pointing at /admin/podcast", () => {
  const src = read("src/app/admin/page.js");
  assert.match(src, /\{ label: "Podcast", href: "\/admin\/podcast", icon: "🎙️", desc: "Upload podcast episodes and series — separate from music releases" \}/);
});

test("GET /api/admin/releases filters both the wizard and legacy-catalog sources by kind, defaulting to music", () => {
  const src = read("src/app/api/admin/releases/route.js");
  assert.match(src, /const kind = new URL\(req\.url\)\.searchParams\.get\("kind"\) === "podcast" \? "podcast" : "music";/);
  const wizardAt = src.indexOf('.from("releases")');
  const wizardBody = src.slice(wizardAt, wizardAt + 700);
  assert.match(wizardBody, /content_kind/);
  assert.match(wizardBody, /\.eq\("content_kind", kind\)/);
  const catalogAt = src.indexOf('"id, slug, title, product_type, release_type, content_kind, active, image_path');
  assert.ok(catalogAt > -1);
  const catalogBody = src.slice(catalogAt, catalogAt + 300);
  assert.match(catalogBody, /\.eq\("content_kind", kind\)/);
});

// ── ReleasesManager: one shared component, two thin pages ───────────────────

test("both /admin/releases and /admin/podcast are thin wrappers around the same shared ReleasesManager component", () => {
  const releasesPage = read("src/app/admin/releases/page.js");
  const podcastPage = read("src/app/admin/podcast/page.js");
  assert.match(releasesPage, /import ReleasesManager from "@\/components\/admin\/ReleasesManager";/);
  assert.match(releasesPage, /<ReleasesManager kind="music" \/>/);
  assert.match(podcastPage, /import ReleasesManager from "@\/components\/admin\/ReleasesManager";/);
  assert.match(podcastPage, /<ReleasesManager kind="podcast" \/>/);
});

test("ReleasesManager fetches the kind-scoped list endpoint and routes uploads/drafts to the matching tab", () => {
  const src = read("src/components/admin/ReleasesManager.js");
  assert.match(src, /export default function ReleasesManager\(\{ kind = "music" \}\)/);
  assert.match(src, /const uploadHref = isPodcast \? "\/admin\/upload\?kind=podcast" : "\/admin\/upload";/);
  assert.match(src, /fetch\(isPodcast \? "\/api\/admin\/releases\?kind=podcast" : "\/api\/admin\/releases"\)/);
});

test("ReleasesManager labels podcast release types as Episode/Series instead of Single/Album", () => {
  const src = read("src/components/admin/ReleasesManager.js");
  const mapAt = src.indexOf("const TYPE_LABELS_BY_KIND = {");
  const body = src.slice(mapAt, mapAt + 500);
  assert.match(body, /music: \{[\s\S]*single:\s*"Single",/);
  assert.match(body, /podcast: \{[\s\S]*single:\s*"Episode",[\s\S]*album:\s*"Series",/);
});
