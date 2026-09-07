import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const MIGRATION = "supabase/migrations/20260906170000_audio_visual_seriez.sql";

test("Seriez is documented as orthogonal to video_type, never a genre value itself — and this migration never touches video_type", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /not a content-genre value on audio_visuals\.video_type/i);
  // Precise, not a broad substring-after-substring check: no DDL statement
  // actually altering/constraining the column, only prose comments naming it.
  assert.doesNotMatch(sql, /audio_visuals_video_type_check/, "this migration must not touch Slice 13's video_type constraint at all");
  assert.doesNotMatch(sql, /check\s*\(\s*video_type/i, "this migration must not add its own video_type check");
});

test("audio_visual_seriez is a standalone container table with its own cover art, credits, cast, and studio badge", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /create table if not exists public\.audio_visual_seriez/);
  assert.match(sql, /title\s+text not null/);
  assert.match(sql, /credits\s+jsonb not null default '\[\]'/);
  assert.match(sql, /cast_members\s+jsonb not null default '\[\]'/);
  assert.match(sql, /poster_r2_key\s+text/);
  assert.match(sql, /metadata\s+jsonb not null default '\{\}'/);
  assert.match(sql, /is_2mrrw_original\s+boolean not null default false/);
});

test("an empty Seriez shell (zero episodes) is documented as a normal, supported state", () => {
  const sql = read(MIGRATION);
  const commentAt = sql.indexOf("comment on table public.audio_visual_seriez");
  const comment = sql.slice(commentAt, commentAt + 300);
  assert.match(comment, /normal, supported state, not a special case/i);
});

test("audio_visuals gains a nullable seriez_id/season_number/episode_number, with on delete set null (never cascade-deleting episodes)", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /add column if not exists seriez_id uuid references public\.audio_visual_seriez\(id\) on delete set null/);
  assert.match(sql, /add column if not exists season_number integer check \(season_number is null or season_number > 0\)/);
  assert.match(sql, /add column if not exists episode_number integer check \(episode_number is null or episode_number > 0\)/);
});

test("season+episode numbering is unique per Seriez, via a plain (non-partial) unique constraint that lets unlimited standalone rows coexist", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /add constraint audio_visuals_seriez_episode_unique\s+unique \(seriez_id, season_number, episode_number\)/);
});

test("Seriez has its own genre classification table, reusing the same genre_taxonomy lookup, independent of any episode's own genre", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /create table if not exists public\.audio_visual_seriez_genre_classifications/);
  assert.match(sql, /seriez_id\s+uuid not null references public\.audio_visual_seriez\(id\) on delete cascade/);
  assert.match(sql, /taxonomy_id uuid not null references public\.genre_taxonomy\(id\) on delete restrict/);
  assert.match(sql, /primary key \(seriez_id, taxonomy_id\)/);
});

test("audio_visual_seriez itself is locked down like audio_visuals (service-role only), but its genre classifications stay public-readable", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /create policy no_public_access on public\.audio_visual_seriez for all to public using \(false\)/);
  assert.match(sql, /create policy public_read on public\.audio_visual_seriez_genre_classifications for select to public using \(true\)/);
  assert.match(sql, /create policy no_public_write on public\.audio_visual_seriez_genre_classifications for insert to public with check \(false\)/);
});
