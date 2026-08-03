/**
 * @2mrrw/core — platform-agnostic business logic.
 *
 * Pure functions only. No UI, no Node built-ins, no browser globals.
 * Safe to import in both apps/web (via tree-shaking) and apps/mobile.
 */

import type { Track, AccessGrant, AccessTier, RepeatMode } from '@2mrrw/types';
import { ACCESS_TIER_PRIORITY, PREVIEW_HARD_CAP_SEC } from '@2mrrw/config';

// ─── Access / Entitlement ────────────────────────────────────────────────────

/** Returns true when the grant allows full-track streaming. */
export function canStreamFull(grant: AccessGrant | undefined): boolean {
  return Boolean(grant?.canStream && !grant?.previewOnly);
}

/** Returns true when the user is preview-only for this track. */
export function isPreviewOnly(grant: AccessGrant | undefined): boolean {
  if (!grant) return true;
  return Boolean(grant.previewOnly) || !grant.canStream;
}

/** Compare two tiers — positive means `a` outranks `b`. */
export function compareTiers(a: AccessTier, b: AccessTier): number {
  return ACCESS_TIER_PRIORITY.indexOf(a) - ACCESS_TIER_PRIORITY.indexOf(b);
}

// ─── Preview Cap ─────────────────────────────────────────────────────────────

/** Returns the clamped display duration for a preview-only track. */
export function previewDisplayDuration(rawDuration: number): number {
  return Math.min(PREVIEW_HARD_CAP_SEC, rawDuration);
}

/** Returns true when the current position is within the preview fade window. */
export function isInPreviewFadeWindow(
  currentTime: number,
  fadeLeadSec = 2
): boolean {
  return currentTime >= PREVIEW_HARD_CAP_SEC - fadeLeadSec;
}

// ─── Track Utilities ─────────────────────────────────────────────────────────

/** Returns the canonical track identifier. */
export function getTrackId(track: Pick<Track, 'id' | 'slug'>): string {
  return track.id || track.slug;
}

/** Returns true when two tracks represent the same playback item. */
export function isSameTrack(
  a: Pick<Track, 'id' | 'slug'> | null | undefined,
  b: Pick<Track, 'id' | 'slug'> | null | undefined
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.id && b.id) return a.id === b.id;
  return a.slug === b.slug;
}

// ─── Queue Utilities ─────────────────────────────────────────────────────────

/** Returns the next queue index for a given repeat mode. */
export function nextQueueIndex(
  current: number,
  total: number,
  repeat: RepeatMode
): number | null {
  if (total === 0) return null;
  if (repeat === 'one') return current;
  if (current < total - 1) return current + 1;
  if (repeat === 'all') return 0;
  return null;
}

/** Returns the previous queue index. */
export function prevQueueIndex(
  current: number,
  total: number,
  repeat: RepeatMode
): number {
  if (total === 0) return 0;
  if (current > 0) return current - 1;
  if (repeat === 'all') return total - 1;
  return 0;
}

// ─── Time Formatting ─────────────────────────────────────────────────────────

/** Formats a duration in seconds as mm:ss or h:mm:ss. */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

/** Parses a mm:ss or h:mm:ss string into seconds. */
export function parseDuration(str: string): number {
  const parts = String(str || '')
    .split(':')
    .map(Number);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3)
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return 0;
}

// ─── Slug Utilities ───────────────────────────────────────────────────────────

/** Converts a raw title to a URL-safe slug. */
export function titleToSlug(title: string): string {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
