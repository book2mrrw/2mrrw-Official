import { getPlaybackPreconnectOrigins } from "@/lib/playback/play-path-domains";

/**
 * Early connection hints for playback CDN origins (preview bytes on guest path).
 * Same-origin /api/library/stream and /api/media/preview reuse the document origin.
 */
export default function PlaybackNetworkHints() {
  const origins = getPlaybackPreconnectOrigins();
  if (!origins.length) return null;

  return (
    <>
      {origins.map((origin) => (
        <link key={`preconnect-${origin}`} rel="preconnect" href={origin} crossOrigin="anonymous" />
      ))}
      {origins.map((origin) => (
        <link key={`dns-prefetch-${origin}`} rel="dns-prefetch" href={origin} />
      ))}
    </>
  );
}
