import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const MIGRATION = "supabase/migrations/20260906200000_audio_visual_short_film_type.sql";

test("video_type gains an 8th value, short_film, alongside every type Slice 13 already established", () => {
  const sql = read(MIGRATION);
  assert.match(
    sql,
    /check \(video_type in \('music_video', 'podcast', 'interview', 'movie', 'documentary', 'vlog', 'concert', 'short_film'\)\)/
  );
});

test("widens the constraint via dynamic lookup-by-definition, since it's re-widening a constraint this project itself created (not guessing at an unknown legacy name)", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /pg_get_constraintdef\(oid\) ilike '%video_type%'/);
});
