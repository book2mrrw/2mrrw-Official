import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const MIGRATION = "supabase/migrations/20260906160000_audio_visual_content_types.sql";

test("the video_type check constraint covers every real content-genre type, and never a structural concept like 'seriez'", () => {
  const sql = read(MIGRATION);
  assert.match(
    sql,
    /check \(video_type in \('music_video', 'podcast', 'interview', 'movie', 'documentary', 'vlog', 'concert'\)\)/,
    "video_type must be exactly these 7 content genres"
  );
  // Seriez is a structural container any of the 7 genres can attach to
  // (Slice 14), never a genre value on this column — a podcast episode of a
  // Seriez still has video_type='podcast'.
  assert.doesNotMatch(sql, /'seriez'/i, "seriez must never appear as a video_type value — it's an orthogonal container, not a genre");
});

test("'concert' is documented as distinct from the ticketed shows_events feature, not a duplicate of it", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /distinct from public\.shows_events/i);
});

test("the video_type constraint is dropped by dynamic lookup before being re-added, safe to re-run even if never applied before", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /select conname into con_name[\s\S]*conrelid = 'public\.audio_visuals'::regclass[\s\S]*video_type/);
  assert.match(sql, /execute format\('alter table public\.audio_visuals drop constraint %I', con_name\)/);
});

test("shared metadata columns exist: credits, cast_members, scheduled_at, duration_seconds, metadata, is_2mrrw_original", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /add column if not exists credits jsonb not null default '\[\]'/);
  assert.match(sql, /add column if not exists cast_members jsonb not null default '\[\]'/);
  assert.match(sql, /add column if not exists scheduled_at timestamptz/);
  assert.match(sql, /add column if not exists duration_seconds numeric/);
  assert.match(sql, /add column if not exists metadata jsonb not null default '\{\}'/);
  assert.match(sql, /add column if not exists is_2mrrw_original boolean not null default false/);
});

test("is_2mrrw_original is documented as a studio badge orthogonal to video_type, never a content type itself", () => {
  const sql = read(MIGRATION);
  const commentAt = sql.indexOf("comment on column public.audio_visuals.is_2mrrw_original");
  assert.ok(commentAt > -1);
  const comment = sql.slice(commentAt, commentAt + 400);
  assert.match(comment, /never a content type/i);
  assert.match(comment, /orthogonal to video_type/i);
});

test("the animated cover art column is documented as isolated from every release/track/audio code path", () => {
  const sql = read(MIGRATION);
  const commentAt = sql.indexOf("comment on column public.audio_visuals.metadata");
  const comment = sql.slice(commentAt, commentAt + 400);
  assert.match(comment, /animated_cover_r2_key/);
  assert.match(comment, /Never read\/written by any release\/track\/audio code path/);
});

test("audio_visual_genre_classifications mirrors release_genre_classifications' shape and reuses the same genre_taxonomy lookup", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /create table if not exists public\.audio_visual_genre_classifications/);
  assert.match(sql, /audio_visual_id uuid not null references public\.audio_visuals\(id\) on delete cascade/);
  assert.match(sql, /taxonomy_id\s+uuid not null references public\.genre_taxonomy\(id\) on delete restrict/);
  assert.match(sql, /role\s+text not null check \(role in \('primary', 'subgenre', 'secondary'\)\)/);
  assert.match(sql, /primary key \(audio_visual_id, taxonomy_id\)/);
});

test("only one primary genre classification is allowed per audio_visual, enforced by a partial unique index", () => {
  const sql = read(MIGRATION);
  assert.match(
    sql,
    /create unique index if not exists audio_visual_genre_classifications_one_primary\s+on public\.audio_visual_genre_classifications \(audio_visual_id\)\s+where role = 'primary'/
  );
});

test("audio_visual_genre_classifications is public-readable but never publicly writable", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /alter table public\.audio_visual_genre_classifications enable row level security/);
  assert.match(sql, /create policy public_read on public\.audio_visual_genre_classifications for select to public using \(true\)/);
  assert.match(sql, /create policy no_public_write on public\.audio_visual_genre_classifications\s+for insert to public with check \(false\)/);
});
