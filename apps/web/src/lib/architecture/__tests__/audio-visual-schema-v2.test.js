import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase/migrations");
const readOnlyMigration = (needle) => {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.includes(needle));
  assert.equal(files.length, 1, `expected exactly one migration matching "${needle}"`);
  return fs.readFileSync(path.join(migrationsDir, files[0]), "utf8");
};

// Canonical Audio Visual schema v2 — codec-generic, long-form-aware,
// videoId/assetVersionId identity throughout, never slug-keyed.

test("audio_visuals links to release/track by stable UUID, never by slug", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  assert.match(sql, /release_id\s+uuid references public\.releases\(id\)/);
  assert.match(sql, /track_id\s+uuid references public\.tracks\(id\)/);
  assert.doesNotMatch(sql, /release_slug|track_slug/);
});

test("the audio_visuals <-> audio_visual_asset_versions circular reference is resolved safely: current_version_id FK added after both tables exist", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  const createAudioVisualsAt = sql.indexOf("create table if not exists public.audio_visuals");
  const createVersionsAt = sql.indexOf("create table if not exists public.audio_visual_asset_versions");
  const fkAt = sql.indexOf("audio_visuals_current_version_id_fkey");
  assert.ok(createAudioVisualsAt > -1 && createVersionsAt > createAudioVisualsAt && fkAt > createVersionsAt,
    "current_version_id FK must be added only after both tables are created");
  const createAudioVisualsBody = sql.slice(createAudioVisualsAt, createVersionsAt);
  assert.match(createAudioVisualsBody, /current_version_id\s+uuid,/, "current_version_id must be a plain column (no inline FK) at table-creation time");
});

test("publication_state gates promotion — no partial publication is representable at the schema level alone (enforced in code, but the states exist)", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  assert.match(sql, /check \(publication_state in \('draft','processing','ready','published','failed','unpublished'\)\)/);
});

test("audio_visual_asset_versions status enum covers the full pipeline, including qc_failed as a distinct early-exit state", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  assert.match(sql, /check \(status in \('uploaded','probing','qc_failed','analyzing','planning','encoding',\s*\n\s*'evaluating_quality','packaging','validating','ready','failed'\)\)/);
});

test("audio_visual_renditions is codec-generic: codec_family is its own column, not baked into resolution_label or hls_prefix naming", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  assert.match(sql, /codec_family\s+text not null check \(codec_family in \('avc','av1'\)\)/);
  assert.match(sql, /unique \(asset_version_id, codec_family, resolution_label, hdr_mode\)/);
});

test("no upscale is representable: bit_depth is constrained to real values (8 or 10), not an open integer", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  assert.match(sql, /bit_depth\s+integer not null default 8 check \(bit_depth in \(8, 10\)\)/);
});

test("audio_visual_sync_maps is keyed by exact track_id and exact video_asset_version_id — a stale mapping can never silently apply to a replaced master or a replaced video", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  assert.match(sql, /track_id\s+uuid not null references public\.tracks\(id\)/);
  assert.match(sql, /video_asset_version_id\s+uuid not null references public\.audio_visual_asset_versions\(id\)/);
  assert.match(sql, /master_snapshot_at\s+timestamptz not null,/);
  assert.match(sql, /unique \(audio_visual_id, track_id, video_asset_version_id\)/);
});

test("sync map supports both the simple offset case and the piecewise segments case without redesign", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  assert.match(sql, /mapping_type\s+text not null check \(mapping_type in \('offset', 'segments'\)\)/);
  assert.match(sql, /offset_ms\s+integer,\s*-- used when mapping_type = 'offset'/);
  assert.match(sql, /segments\s+jsonb,\s*-- used when mapping_type = 'segments'/);
});

test("auto-sync suggestions are never auto-applied — sync_source distinguishes manual from auto, and auto starts as suggested, not confirmed", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  assert.match(sql, /check \(sync_source in \('manual', 'auto_suggested', 'auto_confirmed'\)\)/);
});

test("all four new tables have RLS enabled and a no_public_access policy, matching every other admin-managed media table", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  for (const table of ["audio_visuals", "audio_visual_asset_versions", "audio_visual_renditions", "audio_visual_sync_maps"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(sql, new RegExp(`create policy no_public_access on public\\.${table} for all to public using \\(false\\);`));
  }
});

// ── purchase_items / entitlements constraint expand — dynamic lookup, never a guessed constraint name ──

test("the purchase_items.item_type constraint is replaced via dynamic lookup (pg_constraint), not a hardcoded guessed name", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  const blockAt = sql.indexOf("conrelid = 'public.purchase_items'::regclass");
  assert.ok(blockAt > -1);
  const body = sql.slice(blockAt - 200, blockAt + 400);
  assert.match(body, /select conname into con_name/);
  assert.match(body, /pg_get_constraintdef\(oid\) ilike '%item_type%'/);
  assert.match(body, /execute format\('alter table public\.purchase_items drop constraint %I', con_name\);/);
});

test("item_type gains 'audio_visual' without removing either existing valid value", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  assert.match(sql, /check \(item_type in \('digital', 'merch', 'audio_visual'\)\);/);
});

test("the entitlements.resource_type constraint is likewise replaced via dynamic lookup, gaining 'audio_visual' without removing any existing value", () => {
  const sql = readOnlyMigration("audio_visual_schema_v2");
  const blockAt = sql.indexOf("conrelid = 'public.entitlements'::regclass");
  assert.ok(blockAt > -1);
  const body = sql.slice(blockAt - 200, blockAt + 400);
  assert.match(body, /pg_get_constraintdef\(oid\) ilike '%resource_type%'/);
  assert.match(sql, /check \(resource_type in \('product', 'track', 'release', 'vault_collection', 'audio_visual'\)\);/);
});
