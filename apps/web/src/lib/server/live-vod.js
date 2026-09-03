import { getAuthorizedTwitchAccessToken } from "@/lib/server/twitch-user-authorization";

const TWITCH_VIDEOS_ENDPOINT = "https://api.twitch.tv/helix/videos";
// Twitch can take a few minutes to finish processing a VOD after the stream
// ends. This is called on every cron tick (see cron/twitch-live-reconcile),
// so a broadcast simply gets picked up on a later tick if nothing is ready
// yet — no fixed delay needed here.
const VOD_LOOKBACK_HOURS = 24;

function parseTwitchDuration(value) {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(String(value || ""));
  if (!match) return null;
  const [, h, m, s] = match;
  const seconds = (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
  return seconds > 0 ? seconds : null;
}

async function fetchLatestTwitchVod(broadcasterId, accessToken) {
  const clientId = String(process.env.TWITCH_CLIENT_ID || "").trim();
  const url = `${TWITCH_VIDEOS_ENDPOINT}?user_id=${encodeURIComponent(broadcasterId)}&type=archive&first=1`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data?.data?.[0] || null;
}

/**
 * For any broadcast that ended recently and has no VOD row yet, try to find
 * its matching Twitch VOD and record its metadata (title, duration,
 * thumbnail, Twitch's own hosted playback reference — not the video file
 * itself, see the migration comment for why). Idempotent and safe to call on
 * every cron tick.
 */
export async function reconcileMissingVods(admin) {
  const since = new Date(Date.now() - VOD_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data: candidates, error } = await admin
    .from("live_broadcasts")
    .select("id, started_at, ended_at")
    .eq("is_live", false)
    .not("ended_at", "is", null)
    .gte("ended_at", since)
    .order("ended_at", { ascending: false });
  if (error) throw error;
  if (!candidates?.length) return { captured: 0 };

  const { data: existingVods, error: existingError } = await admin
    .from("live_broadcast_vods")
    .select("broadcast_id")
    .in("broadcast_id", candidates.map((c) => c.id));
  if (existingError) throw existingError;
  const alreadyCaptured = new Set((existingVods || []).map((v) => v.broadcast_id));

  const pending = candidates.filter((c) => !alreadyCaptured.has(c.id));
  if (!pending.length) return { captured: 0 };

  let accessToken, broadcasterId;
  try {
    ({ accessToken, broadcasterId } = await getAuthorizedTwitchAccessToken());
  } catch {
    // Twitch isn't authorized (or the token can't refresh) — nothing to do
    // until an admin re-authorizes; the next cron tick tries again.
    return { captured: 0 };
  }

  const vod = await fetchLatestTwitchVod(broadcasterId, accessToken);
  if (!vod) return { captured: 0 };

  // Only accept a VOD created after the candidate broadcast started —
  // otherwise a stale/previous VOD could get mis-attributed while Twitch is
  // still processing the real one.
  const match = pending.find(
    (c) => Date.parse(vod.created_at) >= Date.parse(c.started_at || c.ended_at)
  );
  if (!match) return { captured: 0 };

  const { error: insertError } = await admin.from("live_broadcast_vods").insert({
    broadcast_id: match.id,
    twitch_video_id: vod.id,
    title: vod.title || "2MRRW Live",
    duration_seconds: parseTwitchDuration(vod.duration),
    thumbnail_url: vod.thumbnail_url || null,
    twitch_url: vod.url,
    published: false,
  });
  // A concurrent cron tick winning the same insert is fine — the unique
  // constraint on broadcast_id makes this idempotent, not an error.
  if (insertError && insertError.code !== "23505") throw insertError;

  return { captured: insertError ? 0 : 1 };
}
