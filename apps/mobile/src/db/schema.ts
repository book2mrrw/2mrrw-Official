import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const cachedTracks = sqliteTable('cached_tracks', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  cover: text('cover'),
  src: text('src').notNull(),
  gainDb: real('gain_db'),
  releaseId: text('release_id'),
  cachedAt: integer('cached_at', { mode: 'timestamp' }).notNull(),
});

export const cachedReleases = sqliteTable('cached_releases', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  cover: text('cover'),
  coverArtType: text('cover_art_type').notNull().default('image'),
  type: text('type').notNull(),
  releaseDate: text('release_date'),
  cachedAt: integer('cached_at', { mode: 'timestamp' }).notNull(),
});

export const downloadedTracks = sqliteTable('downloaded_tracks', {
  id: text('id').primaryKey(),
  trackId: text('track_id').notNull(),
  localPath: text('local_path').notNull(),
  fileSize: integer('file_size'),
  downloadedAt: integer('downloaded_at', { mode: 'timestamp' }).notNull(),
});

export const playbackHistory = sqliteTable('playback_history', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  trackId: text('track_id').notNull(),
  playedAt: integer('played_at', { mode: 'timestamp' }).notNull(),
  durationSec: real('duration_sec'),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
});

export const queueSnapshot = sqliteTable('queue_snapshot', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  trackIds: text('track_ids').notNull(), // JSON array
  currentIndex: integer('current_index').notNull().default(0),
  savedAt: integer('saved_at', { mode: 'timestamp' }).notNull(),
});
