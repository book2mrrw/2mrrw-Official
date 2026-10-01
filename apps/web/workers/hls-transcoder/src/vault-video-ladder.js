/**
 * The vault video ladder, as the worker sees it.
 *
 * A hand-kept mirror of apps/web/src/lib/vault/vault-video-contract.js: the
 * web app and this worker are separate deployables with no shared module path,
 * the same reason derive-key.js duplicates the app's key derivation.
 *
 * It lives in its own file, free of any side-effecting import, so a test on
 * the app side can import both copies and prove they still agree. Hand-synced
 * constants drift silently otherwise, and here a drift means the worker
 * encodes a rung the master playlist will not advertise -- or advertises one
 * that was never encoded.
 */

export const LADDER = Object.freeze([
  { bitrate: "4000k", height: 1080, maxrate: "4400k", bufsize: "8000k", audio: "128k" },
  { bitrate: "2000k", height: 720,  maxrate: "2200k", bufsize: "4000k", audio: "128k" },
  { bitrate: "1000k", height: 540,  maxrate: "1100k", bufsize: "2000k", audio: "96k"  },
  { bitrate: "720k",  height: 360,  maxrate: "800k",  bufsize: "1600k", audio: "96k"  },
]);

export const SEGMENT_SECONDS = 6;

export function ladderForSourceHeight(sourceHeight) {
  const h = Math.floor(Number(sourceHeight));
  if (!Number.isFinite(h) || h <= 0) return LADDER.map((r) => ({ ...r, encodeHeight: r.height }));

  const atOrBelow = LADDER.filter((r) => r.height <= h);
  const sitsBetween = !LADDER.some((r) => r.height === h);
  const firstAbove = sitsBetween ? [...LADDER].reverse().find((r) => r.height > h) : null;

  const chosen = [];
  if (firstAbove) chosen.push({ ...firstAbove, encodeHeight: h % 2 === 0 ? h : h - 1 });
  for (const r of atOrBelow) chosen.push({ ...r, encodeHeight: r.height });
  chosen.sort(
    (a, b) =>
      LADDER.findIndex((r) => r.bitrate === a.bitrate) -
      LADDER.findIndex((r) => r.bitrate === b.bitrate)
  );
  return chosen;
}
