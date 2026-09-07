/**
 * Release-cadence visibility rule for a Seriez episode list — the explicit
 * problem the user flagged: a viewer must never be confused about what's
 * actually out yet vs. merely planned, on a weekly/biweekly/monthly (or any
 * other) release cadence.
 *
 * An episode is visible in exactly one of two states:
 *   - "playable"  — publication_state === 'published'
 *   - "upcoming"  — not yet published, but has a real scheduled_at in the
 *                   future, shown with that real date
 *
 * Anything else (draft, processing, a 'ready' row with no schedule set yet,
 * failed, unpublished) is excluded entirely — never shown as a vague,
 * unstamped "more coming" placeholder, since that's exactly the kind of
 * ambiguity this rule exists to prevent.
 */

/**
 * @param {Array<{ id, slug, title, video_type, publication_state, scheduled_at, season_number, episode_number, poster_r2_key }>} episodes
 * @param {number} [nowMs] - injectable for tests
 * @param {(key: string|null) => string|null} [urlFn] - injectable for tests
 */
export function resolveVisibleEpisodes(episodes, nowMs = Date.now(), urlFn = (key) => key) {
  return (episodes || [])
    .filter((e) => e.publication_state === "published" || (e.scheduled_at && new Date(e.scheduled_at).getTime() > nowMs))
    .map((e) => ({
      video_id: e.id,
      slug: e.slug,
      title: e.title,
      video_type: e.video_type,
      season_number: e.season_number,
      episode_number: e.episode_number,
      poster_url: e.poster_r2_key ? urlFn(e.poster_r2_key) : null,
      status: e.publication_state === "published" ? "playable" : "upcoming",
      scheduled_at: e.publication_state === "published" ? null : e.scheduled_at,
    }));
}
