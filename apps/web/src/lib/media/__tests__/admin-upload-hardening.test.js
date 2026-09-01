import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");
const uploadContracts = read("src/lib/media/admin-upload-contract.js");

describe("admin upload MIME authority", () => {
  const presign = read("src/app/api/admin/upload/presigned/route.js");
  const client = read("src/lib/media/r2-upload-client.js");

  test("server maps every supported extension to a canonical MIME", () => {
    for (const pair of [
      ['wav: "audio/wav"', 'wave: "audio/wav"', 'flac: "audio/flac"'],
      ['aiff: "audio/aiff"', 'aif: "audio/aiff"'],
      ['jpg: "image/jpeg"', 'jpeg: "image/jpeg"', 'png: "image/png"', 'webp: "image/webp"'],
      ['mp4: "video/mp4"', 'mp3: "audio/mpeg"'],
      ['mov: "video/quicktime"', 'webm: "video/webm"'],
    ].flat()) assert.match(uploadContracts, new RegExp(pair.replace(/[/.]/g, "\\$&")));
    assert.match(presign, /ADMIN_UPLOAD_CONTRACTS\[assetType\]/);
  });

  test("unsupported extensions and invalid sizes fail closed", () => {
    assert.match(presign, /if \(!contentType\)/);
    assert.ok(!/application\/octet-stream/.test(presign));
    assert.match(presign, /!Number\.isSafeInteger\(size\) \|\| size <= 0/);
  });

  test("the exact server MIME is signed, returned, and sent", () => {
    assert.match(presign, /createR2SignedPutUrl\(key, contentType,/);
    assert.match(presign, /\{ uploadUrl, key, contentType, expiresAt \}/);
    assert.match(client, /xhr\.setRequestHeader\("Content-Type", contentType\)/);
    assert.ok(!/file\.type/.test(client.replace(/\/\*[\s\S]*?\*\//g, "")));
  });
});

describe("one upload transport and one storefront invalidator", () => {
  test("normal assets use the shared transport and master replacements use the staged transport", () => {
    const wizard = read("src/components/admin/UploadWizard.js");
    const releases = read("src/app/admin/releases/page.js");
    const inline = read("src/components/admin/InlineReleasesManager.js");
    assert.equal((wizard.match(/uploadAssetToR2\s*\(/g) || []).length, 4);
    assert.equal((releases.match(/uploadAssetToR2\s*\(/g) || []).length, 1);
    assert.equal((inline.match(/uploadAssetToR2\s*\(/g) || []).length, 1);
    for (const source of [releases, inline]) {
      assert.match(source, /stageMasterReplacement\s*\(/);
      assert.match(source, /beginMasterReplacement\s*\(/);
      assert.match(source, /watchMasterReplacement\s*\(/);
    }
    for (const source of [wizard, releases, inline]) {
      assert.ok(!source.includes("/api/admin/upload/presigned"));
      assert.ok(!source.includes("new XMLHttpRequest"));
    }
  });

  test("cover selection uses a persistent input and validates completion", () => {
    const wizard = read("src/components/admin/UploadWizard.js");
    assert.match(wizard, /ref=\{coverInputRef\}/);
    assert.match(wizard, /coverInputRef\.current\?\.click\(\)/);
    assert.ok(!/const pickCover = \(\) => \{\s*const input = document\.createElement/.test(wizard));
    assert.match(wizard, /if \(!completeRes\.ok\)/);
  });

  test("single and multi-track audio pickers persist through first selection", () => {
    const wizard = read("src/components/admin/UploadWizard.js");
    assert.match(wizard, /ref=\{audioInputRef\}/);
    assert.match(wizard, /audioInputRef\.current\?\.click\(\)/);
    assert.match(wizard, /ref=\{fileInputRef\}/);
    assert.ok(!/const pickFile = \(\) => \{\s*const input = document\.createElement/.test(wizard));
  });

  test("cover video selection shares MP4, MOV, WebM and seven-minute rules", () => {
    const wizard = read("src/components/admin/UploadWizard.js");
    const complete = read("src/app/api/admin/upload/complete/route.js");
    assert.match(wizard, /ref=\{videoInputRef\}/);
    assert.match(wizard, /accept=\{VIDEO_COVER_ACCEPT\}/);
    assert.match(uploadContracts, /VIDEO_COVER_ACCEPT[\s\S]*video\/mp4[\s\S]*video\/quicktime[\s\S]*video\/webm/);
    assert.match(wizard, /durationSeconds > 420\.5/);
    assert.match(wizard, /assetType: "cover-video"/);
    assert.match(complete, /ADMIN_UPLOAD_CONTRACTS\["cover-video"\]\.maxDurationSeconds/);
  });

  test("My Releases reports success only after the staged revision becomes active", () => {
    const inline = read("src/components/admin/InlineReleasesManager.js");
    const uploadStart = inline.indexOf("const uploadAudio");
    const stageCall = inline.indexOf("stageMasterReplacement({", uploadStart);
    const promoteSignal = inline.indexOf('status.status === "active"', stageCall);
    assert.ok(stageCall > uploadStart && promoteSignal > stageCall);
    assert.match(inline, /signalCatalogMutation\("release_master_promoted"\)/);
    assert.ok(!inline.includes('setAudioPhase("confirming")'));
    assert.ok(!inline.includes('audioPhase === "confirming"'));
  });

  test("master cleanup is delayed until after atomic promotion and retention", () => {
    const migration = read("supabase/migrations/20260901000000_audio_master_revision_authority.sql");
    const cron = read("src/app/api/cron/retire-audio-master-revisions/route.js");
    assert.match(migration, /promote_audio_master_revision/);
    assert.match(migration, /retire_after/);
    assert.match(migration, /interval '7 days'/i);
    assert.match(cron, /status[\s\S]*retired/);
    assert.match(cron, /deleteR2Object/);
  });

  test("catalog DB has no explicit cache beneath ISR", () => {
    const catalog = read("src/lib/media/catalog-db.js");
    assert.ok(!/unstable_cache|revalidateTag|\bcache\s*\(|redis/i.test(catalog));
  });
});

describe("release upload database contract", () => {
  const migration = read("supabase/migrations/20260823000010_tracks_upload_contract_closure.sql");

  test("tracks supplies every field shared by complete, publish, edit, and replace-master", () => {
    for (const column of ["position", "master_history", "slug"]) {
      assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    }
    assert.match(migration, /ALTER COLUMN slug SET NOT NULL/);
    assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
  });

  test("the publish linkage column is present even when the earlier migration was skipped", () => {
    assert.match(migration, /public\.products[\s\S]*ADD COLUMN IF NOT EXISTS release_id uuid/);
  });

  test("live routes tolerate the pre-migration tracks table", () => {
    const complete = read("src/app/api/admin/upload/complete/route.js");
    const publish = read("src/app/api/admin/releases/[id]/publish/route.js");
    const replace = read("src/app/api/admin/releases/[id]/replace-master/route.js");
    const detail = read("src/app/api/admin/releases/[id]/route.js");
    assert.ok(!complete.includes('.eq("slug", trackSlug)'));
    assert.ok(!complete.includes("slug: trackSlug || slug"));
    assert.ok(!publish.includes('.select("id, slug, title'));
    assert.ok(!replace.includes("master_history, slug"));
    assert.ok(!/\.from\("tracks"\)[\s\S]{0,120}\.select\("id, slug, title/.test(detail));
  });

  test("Next 16 release routes await dynamic params", () => {
    for (const relative of [
      "src/app/api/admin/releases/[id]/publish/route.js",
      "src/app/api/admin/releases/[id]/replace-master/route.js",
      "src/app/api/admin/releases/[id]/status/route.js",
      "src/app/api/admin/releases/[id]/route.js",
    ]) {
      const route = read(relative);
      assert.ok(!/\}\s*=\s*params\s*;/.test(route), `${relative} reads async params synchronously`);
      assert.match(route, /\}\s*=\s*await params\s*;/);
    }
  });

  test("draft identity persists and draft creation is idempotent", () => {
    const wizard = read("src/components/admin/UploadWizard.js");
    const draft = read("src/app/api/admin/releases/draft/route.js");
    const migration = read("supabase/migrations/20260823000020_release_upload_session_identity.sql");
    assert.match(wizard, /sessionStorage\.setItem\("2mrrw\.admin\.release-upload"/);
    assert.match(wizard, /upload_session_id: uploadSessionIdRef\.current/);
    assert.match(wizard, /setReleaseId\(json\.release_id\)/);
    assert.match(draft, /contains\("metadata", \{ upload_session_id: uploadSessionId \}\)/);
    assert.match(draft, /release_id: data\.id/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS releases_upload_session_id_uidx/);
  });
});

describe("publish cannot silently half-succeed", () => {
  const publish = read("src/app/api/admin/releases/[id]/publish/route.js");

  test("Supabase builders are awaited and inspected instead of treated like native Promises", () => {
    assert.doesNotMatch(
      publish,
      /await\s+[A-Za-z_$][\w$]*(?:(?!;)[\s\S])*?\.from\((?:(?!;)[\s\S])*?\.catch\(/,
      "Supabase query builders do not implement Promise.catch(); destructure and inspect their error result",
    );
    assert.match(publish, /if \(trackCanonicalizeError\)/);
    assert.match(publish, /if \(hlsCanonicalizeError\)/);
    assert.match(publish, /if \(coverKeyUpdateError\) throw coverKeyUpdateError/);
    assert.match(publish, /if \(singleTrackUpdateError\)/);
  });

  test("a failed tracklist write blocks publish instead of leaving a live release with no tracks", () => {
    assert.match(publish, /if \(trackErr\) \{\s*console\.error\("\[publish\] catalog_tracks upsert error"/);
    assert.ok(!publish.includes('console.error("[publish] catalog_tracks upsert error (non-fatal)"'));
  });

  test("a failed lifecycle status transition is returned as an error, never told to the admin as success", () => {
    assert.match(publish, /const \{ error: releaseUpdateErr \} = await admin\s*\.from\("releases"\)\s*\.update\(releaseUpdate\)\s*\.eq\("id", releaseId\);/);
    assert.match(publish, /if \(releaseUpdateErr\) \{[\s\S]{0,500}status: 500 \}/);
    assert.ok(!publish.includes('.eq("id", releaseId).catch((err) => {\n    console.warn("[publish] release status update error'));
  });
});

describe("reopening a draft never re-requires an already-uploaded asset", () => {
  const wizard = read("src/components/admin/UploadWizard.js");
  const inline = read("src/components/admin/InlineReleasesManager.js");
  const draftRoute = read("src/app/api/admin/releases/[id]/draft/route.js");

  test("single/feature audio step seeds ready state from the persisted key, not idle", () => {
    assert.ok(wizard.includes('status: data.audio_key ? "ready" : "idle"'),
      "AudioUploadStep must seed from data.audio_key like ArtworkLyricsStep already does for cover_key");
    assert.ok(wizard.includes('disabled={status !== "ready" && !data.audio_key}'),
      "Continue must not be permanently blocked when a draft resumes with audio already attached");
  });

  test("My Releases editor seeds cover/animated-cover state from persisted keys", () => {
    assert.ok(inline.includes('status: relStub.cover_art_r2_key ? "done" : "idle"'));
    assert.ok(inline.includes('status: relStub.metadata?.animated_cover_r2_key ? "done" : "idle"'));
    assert.ok(inline.includes("catalogMotionVideoUrl"),
      "an existing animated cover must render as a preview on reopen, not read as absent");
  });

  test("My Releases editor never clobbers a legitimate $0 price with an empty string", () => {
    assert.ok(inline.includes("Number.isFinite(d.product?.price_cents)"));
    assert.ok(!inline.includes("d.product?.price_cents ? (d.product.price_cents / 100).toFixed(2) : \"\""));
  });

  test("draft autosave never nulls a previously-saved release_date or cover on a partial payload", () => {
    assert.ok(draftRoute.includes("release_date: data.release_date ?? release.release_date"));
    assert.ok(draftRoute.includes("cover_art_r2_key: data.cover_key ?? release.cover_art_r2_key"));
    assert.ok(!draftRoute.includes("release_date: data.release_date || null"));
    assert.ok(!draftRoute.includes("cover_art_r2_key: data.cover_key || null"));
  });

  test("draft PUT merges onto the prior snapshot instead of blind-replacing it", () => {
    assert.ok(draftRoute.includes('data: { ...priorData, ...(payload.data || {}) }'),
      "an out-of-order or partial save must never erase fields a prior save already persisted");
  });
});

describe("draft-list rows are openable without hitting a precise Edit target", () => {
  test("the My Releases card row is a real interactive element that opens the release", () => {
    const inline = read("src/components/admin/InlineReleasesManager.js");
    assert.match(inline, /role="button"[\s\S]{0,80}tabIndex=\{0\}[\s\S]{0,400}onClick=\{\(\) => onEdit\(rel\)\}/);
    assert.match(inline, /onKeyDown=\{\(e\) => \{\s*if \(e\.key === "Enter" \|\| e\.key === " "\)/);
  });

  test("row actions stop propagation so they never also open the release", () => {
    const inline = read("src/components/admin/InlineReleasesManager.js");
    assert.match(inline, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
    assert.match(inline, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onEdit\(rel\); \}\}/);

    const adminPage = read("src/app/admin/releases/page.js");
    assert.match(adminPage, /onClick=\{isDraft \? \(\) => router\.push\(`\/admin\/upload\?draft=\$\{rel\.id\}`\) : undefined\}/);
    assert.match(adminPage, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });
});

describe("a pending autosave is flushed on soft navigation away from the wizard, not just on tab close", () => {
  test("the wizard flushes the latest draft snapshot on unmount, not only on pagehide", () => {
    const wizard = read("src/components/admin/UploadWizard.js");
    assert.match(wizard, /const flushPendingDraftSave = useCallback\(\(\) => \{/);
    assert.match(wizard, /window\.addEventListener\("pagehide", flushPendingDraftSave\);/);
    assert.match(wizard, /useEffect\(\(\) => \(\) => flushPendingDraftSave\(\), \[flushPendingDraftSave\]\);/);
  });
});

describe("release type cannot change mid-draft into a shape existing tracks don't fit", () => {
  const draftRoute = read("src/app/api/admin/releases/[id]/draft/route.js");

  test("switching single-track <-> multi-track categories is blocked once tracks exist", () => {
    assert.match(draftRoute, /const oldIsMultiTrack = MULTI_TRACK_TYPES\.has\(release\.release_type\);/);
    assert.match(draftRoute, /const newIsMultiTrack = MULTI_TRACK_TYPES\.has\(requestedType\);/);
    assert.match(draftRoute, /if \(oldIsMultiTrack !== newIsMultiTrack\) \{/);
    assert.match(draftRoute, /status: 409 \}\);/);
  });

  test("an invalid release_type value is rejected rather than silently stored", () => {
    assert.match(draftRoute, /if \(!VALID_RELEASE_TYPES\.has\(requestedType\)\) \{/);
  });

  test("same-category type changes (Single<->Feature, Album<->EP<->Mixtape) remain allowed", () => {
    assert.match(draftRoute, /MULTI_TRACK_TYPES = new Set\(\["album", "ep", "mixtape"\]\);/);
    assert.match(draftRoute, /VALID_RELEASE_TYPES = new Set\(\["single", "feature", "album", "ep", "mixtape"\]\);/);
  });
});

describe("removing a track in the wizard cannot let it silently reappear at publish", () => {
  const wizard = read("src/components/admin/UploadWizard.js");
  const trackRoute = read("src/app/api/admin/releases/[id]/tracks/[trackId]/route.js");

  test("removeTrack calls the server for any track that already has a persisted id", () => {
    assert.match(wizard, /if \(!track\.id\) \{/);
    assert.match(wizard, /fetch\(`\/api\/admin\/releases\/\$\{releaseId\}\/tracks\/\$\{track\.id\}`, \{ method: "DELETE" \}\)/);
    assert.match(wizard, /if \(!res\.ok\) throw new Error\(json\.error \|\| "Failed to remove track"\);/);
  });

  test("a failed server-side removal keeps the track in the list and surfaces the error, never silently drops it", () => {
    assert.match(wizard, /setRemoving\(false\);\s*\n\s*setRemoveError\(err\.message\);/);
    assert.match(wizard, /Could not remove this track: \{removeError\}/);
  });

  test("the delete route only allows track removal while the release is still a draft", () => {
    assert.match(trackRoute, /if \(release\.status !== "draft"\) \{/);
  });

  test("the delete route actually removes the DB row publish() would otherwise still find", () => {
    assert.match(trackRoute, /await admin\.from\("tracks"\)\.delete\(\)\.eq\("id", trackId\);/);
  });
});

describe("scheduled-release activation cannot split-brain releases.status and products.active", () => {
  test("the cron calls one atomic RPC instead of two independent table updates", () => {
    const cron = read("src/app/api/cron/publish-scheduled/route.js");
    assert.match(cron, /admin\s*\.rpc\("activate_scheduled_release", \{ p_release_id: rel\.id \}\)\s*\.single\(\);/);
    assert.ok(!cron.includes('.from("releases")\n        .update({ status: "published"'),
      "the old two-write race must not still be present alongside the RPC call");
  });

  test("the atomic activation function exists as a migration, is idempotent, and is locked to service_role", () => {
    const migration = read("supabase/migrations/20260827000052_atomic_scheduled_release_activation.sql");
    assert.match(migration, /create or replace function public\.activate_scheduled_release/);
    assert.match(migration, /and status = 'scheduled'/);
    assert.match(migration, /and available_at <= p_now/);
    assert.match(migration, /revoke all on function public\.activate_scheduled_release\(uuid, timestamptz\) from public, anon, authenticated;/);
    assert.match(migration, /grant execute on function public\.activate_scheduled_release\(uuid, timestamptz\) to service_role;/);
  });

  test("a products update matching zero (or more than one) rows rolls back the whole activation instead of committing split-brained", () => {
    // Forward-only correction on top of ...052 — Postgres does not error on an
    // UPDATE that matches zero rows, so the original version could still
    // commit releases.status='published' with no corresponding active
    // product. This asserts the fix: the row count is checked and a mismatch
    // raises inside the same transaction, rolling back the releases update too.
    const fix = read("supabase/migrations/20260827000053_activate_scheduled_release_requires_product.sql");
    assert.match(fix, /create or replace function public\.activate_scheduled_release/);
    assert.match(fix, /get diagnostics v_product_count = row_count;/);
    assert.match(fix, /if v_product_count <> 1 then/);
    assert.match(fix, /raise exception/);
    assert.match(fix, /grant execute on function public\.activate_scheduled_release\(uuid, timestamptz\) to service_role;/);
  });

  test("the cron already treats any RPC error as a per-release failure that retries next tick, with no change needed there", () => {
    const cron = read("src/app/api/cron/publish-scheduled/route.js");
    assert.match(cron, /if \(rpcErr\) throw rpcErr;/);
    assert.match(cron, /results\.push\(\{ id: rel\.id, slug: rel\.slug, ok: false, error: err\.message \}\);/);
  });
});

describe("the two vercel.json cron manifests cannot silently disagree", () => {
  test("both files declare the same schedule for every cron path", () => {
    const root = JSON.parse(read("../../vercel.json"));
    const web = JSON.parse(read("vercel.json"));
    const bySchedule = (crons) => Object.fromEntries(crons.map((c) => [c.path, c.schedule]));
    const rootCrons = bySchedule(root.crons);
    const webCrons = bySchedule(web.crons);
    assert.deepEqual(rootCrons, webCrons,
      "root vercel.json and apps/web/vercel.json must declare identical cron schedules — a prior drift had publish-scheduled at */5 in one file and * * * * * in the other");
    assert.equal(rootCrons["/api/cron/publish-scheduled"], "* * * * *");
  });
});

describe("Albums and Mixtapes & EPs render from the live catalog, not a hardcoded fallback", () => {
  const homeClient = read("src/app/HomeClient.js");

  test("PageStorefront receives the DB-backed catalog and shadows the module-level fallback constants", () => {
    assert.match(homeClient, /<PageStorefront\s*\n\s*initialEvents=\{initialEvents\}\s*\n\s*effectiveAlbums=\{effectiveAlbums\}\s*\n\s*effectiveMixtapes=\{effectiveMixtapes\}/);
    assert.match(homeClient, /function PageStorefront\(\{ initialEvents, effectiveAlbums, effectiveMixtapes \}\)/);
    assert.match(homeClient, /const albums = effectiveAlbums;/);
    assert.match(homeClient, /const mixtapesAndEps = effectiveMixtapes;/);
  });

  test("effectiveAlbums/effectiveMixtapes are still DB-first with a hardcoded fallback, not the reverse", () => {
    assert.match(homeClient, /const effectiveAlbums =\s*\n\s*initialCatalog\?\.albums\?\.length > 0/);
    assert.match(homeClient, /const effectiveMixtapes =\s*\n\s*initialCatalog\?\.mixtapes\?\.length > 0/);
  });
});

describe("unpublishing a release is as immediate as publishing it", () => {
  test("archiving a release revalidates the storefront instead of waiting out the ISR window", () => {
    const route = read("src/app/api/admin/releases/[id]/route.js");
    const archiveBlock = route.slice(route.indexOf('if (body.action === "archive")'), route.indexOf('if (body.action === "archive")') + 1000);
    assert.match(archiveBlock, /revalidateStorefront\(archivedRelease\?\.slug, archivedRelease\?\.release_type\)/);
  });
});

describe("the public singles API is a bounded projection of canonical Supabase truth", () => {
  const route = read("src/app/api/catalog/releases/route.js");
  const catalogDb = read("src/lib/media/catalog-db.js");

  test("the route cannot fall back to the independent Control System catalog", () => {
    assert.match(route, /getStorefrontSinglesPageFromDB/);
    assert.doesNotMatch(route, /control-system|getLatestControlSystemSingles/i);
    assert.match(route, /export const dynamic = "force-dynamic"/);
    assert.match(route, /export const revalidate = 0/);
    assert.match(route, /export const fetchCache = "force-no-store"/);
    assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  });

  test("the bounded DB query has an exact count and reuses the canonical mapper", () => {
    assert.match(catalogDb, /export async function getStorefrontSinglesPageFromDB/);
    assert.match(catalogDb, /\{ count: "exact" \}/);
    assert.match(catalogDb, /\.eq\("product_type", "single"\)/);
    assert.match(catalogDb, /\.eq\("active", true\)/);
    assert.match(catalogDb, /\.range\(normalizedOffset, normalizedOffset \+ normalizedLimit - 1\)/);
    assert.match(catalogDb, /const projected = \(data \|\| \[\]\)\.map\(mapProductRow\)/);
    assert.match(catalogDb, /const availability = lifecycleRow \? releaseAvailability\(lifecycleRow\) : null/);
  });

  test("lifecycle-invisible projection mismatches fail closed per row", () => {
    assert.match(catalogDb, /const releases = projected\.filter/);
    assert.match(catalogDb, /!release\.availability \|\| release\.availability\.visible/);
    assert.match(catalogDb, /projectionTotal: count/);
    assert.doesNotMatch(catalogDb, /throw new Error\("catalog_projection_inconsistent"\)/);
  });

  test("healthy empty catalogs and database failures are observably different", () => {
    assert.match(route, /fallback: false/);
    assert.match(route, /source: "supabase"/);
    assert.match(route, /error: "catalog_unavailable"/);
    assert.match(route, /\{ status: 503, headers: NO_STORE_HEADERS \}/);
  });

  test("web tracks and mobile releases retain compatible response keys", () => {
    assert.match(route, /tracks,/);
    assert.match(route, /releases: tracks/);
    assert.match(route, /releases: \[\]/);
    assert.match(catalogDb, /id: row\.id \|\| row\.slug/);
    assert.match(catalogDb, /releaseDate: row\.release_date \|\| meta\.release_date \|\| null/);
    assert.match(catalogDb, /tracks: \[\]/);
  });
});

describe("draft mutations never bust the public storefront cache", () => {
  test("draft-scoped upload/complete and replace-master calls are gated on release status", () => {
    const complete = read("src/app/api/admin/upload/complete/route.js");
    const replaceMaster = read("src/app/api/admin/releases/[id]/replace-master/route.js");
    const promoted = read("src/app/api/admin/hls/complete/route.js");
    assert.match(complete, /if \(!audioRelStatus \|\| audioRelStatus\.status !== "draft"\) revalidateStorefront\(\);/);
    assert.match(complete, /if \(promotion\?\.status !== "draft"\) revalidateStorefront\(promotion\?\.slug, promotion\?\.releaseType\);/);
    assert.doesNotMatch(replaceMaster, /revalidateStorefront\(/);
    assert.match(promoted, /if \(body\.replacementId\)[\s\S]*revalidateStorefront\(slug\)/);
  });

  test("the release PATCH route revalidates using the post-update status, not the pre-fetch one", () => {
    const route = read("src/app/api/admin/releases/[id]/route.js");
    assert.match(route, /const finalStatus = lifecycleUpdates\.status \|\| release\.status;/);
    assert.match(route, /if \(finalStatus !== "draft"\) \{\s*revalidateStorefront\(release\.slug, release\.release_type\);/);
  });
});
