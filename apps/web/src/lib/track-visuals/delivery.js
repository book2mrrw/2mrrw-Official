import { createHmac } from 'node:crypto';
import { getAdminClient } from '@/lib/supabase/admin';
import { createR2SignedGetUrl } from '@/lib/storage/r2';
import { verifyVisualToken } from './token';
const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/vnd.apple.mpegurl' };
const reject = status => new Response(null, { status, headers });
export async function visualDelivery(req, context, kind) {
  const { versionId } = await context.params;
  const url = new URL(req.url), token = url.searchParams.get('token');
  if (!verifyVisualToken(token, versionId)) return reject(403);
  try {
    const { data, error } = await getAdminClient().from('track_visual_versions').select('manifest,status,track_id').eq('id', versionId).maybeSingle();
    if (error) throw error;
    if (data?.status !== 'ready' || data.manifest?.assetVersionId !== versionId) return reject(404);
    const manifest = data.manifest, base = `/api/track-visuals/${versionId}`;
    const query = new URLSearchParams({ token });
    if (kind === 'key') {
      const secret = process.env.TRACK_VISUAL_MASTER_SECRET || process.env.HLS_MASTER_SECRET;
      if (!secret) throw new Error('Visual key unavailable');
      const key = createHmac('sha256', secret).update(`2mrrw:track-visual:${versionId}:key`).digest().subarray(0, 16);
      return new Response(key, { headers: { ...headers, 'Content-Type': 'application/octet-stream' } });
    }
    if (kind === 'manifest') {
      const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];
      for (const r of manifest.renditions) {
        lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.width}x${r.height},CODECS="${r.codecs}",FRAME-RATE=${r.frameRate.toFixed(3)}`,
          `${base}/variant?${query}&rendition=${encodeURIComponent(r.id)}`);
      }
      return new Response(lines.join('\n') + '\n', { headers });
    }
    const r = manifest.renditions.find(item => item.id === url.searchParams.get('rendition'));
    if (!r || !r.prefix.startsWith(`track-visuals/renditions/${data.track_id}/${versionId}/`) || r.segments.some(name => !/^seg_\d+\.ts$/.test(name))) return reject(404);
    const segments = await Promise.all(r.segments.map(name => createR2SignedGetUrl(r.prefix + name, 28800)));
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-INDEPENDENT-SEGMENTS',
      `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...r.durations))}`, '#EXT-X-MEDIA-SEQUENCE:0',
      `#EXT-X-KEY:METHOD=AES-128,URI="${base}/key?${query}",IV=0x${manifest.iv}`];
    segments.forEach((uri, i) => lines.push(`#EXTINF:${r.durations[i].toFixed(6)},`, uri));
    lines.push('#EXT-X-ENDLIST');
    return new Response(lines.join('\n') + '\n', { headers });
  } catch { return reject(503); }
}
