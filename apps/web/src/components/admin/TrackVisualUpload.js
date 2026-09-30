'use client';
import { useEffect, useRef, useState } from 'react';
import { UUID_RE, VISUAL_MAX_BYTES, visualUploadType } from '@/lib/track-visuals/contract';
export default function TrackVisualUpload({ releaseId, trackId }) {
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const abortRef = useRef(null), generation = useRef(0);
  useEffect(() => {
    const own = ++generation.current, abort = new AbortController(); let timer;
    setStatus(null); setError(''); setBusy(false);
    if (!UUID_RE.test(trackId || '') || !UUID_RE.test(releaseId || '')) return undefined;
    async function poll() {
      try {
        const res = await fetch(`/api/admin/track-visuals?${new URLSearchParams({ trackId, releaseId })}`, { signal: abort.signal, cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json(); if (generation.current !== own) return;
        setStatus(data);
        if (data.enabled !== false) timer = setTimeout(poll, 10000);
      } catch { /* A status failure cannot affect audio uploads. */ }
    }
    void poll();
    return () => { ++generation.current; abort.abort(); abortRef.current?.abort(); clearTimeout(timer); };
  }, [releaseId, trackId]);
  async function post(body, signal) {
    const res = await fetch('/api/admin/track-visuals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, releaseId, trackId }), signal });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Visual upload failed'); return data;
  }
  async function upload(file) {
    if (!file) return;
    if (!visualUploadType(file.name) || file.size > VISUAL_MAX_BYTES || !file.size) { setError('Choose an MP4 or MOV up to 5 GB, 7–30 seconds long.'); return; }
    const own = generation.current, abort = new AbortController(); abortRef.current = abort;
    setBusy(true); setError('');
    try {
      const prepared = await post({ action: 'prepare', filename: file.name, size: file.size }, abort.signal);
      const uploaded = await fetch(prepared.uploadUrl, { method: 'PUT', headers: { 'Content-Type': prepared.contentType }, body: file, signal: abort.signal });
      if (!uploaded.ok) throw new Error('Visual file upload failed');
      await post({ action: 'complete', versionId: prepared.versionId }, abort.signal);
      if (generation.current === own) setStatus(previous => ({ ...previous, version: { id: prepared.versionId, status: 'pending' } }));
    } catch (e) { if (generation.current === own && !abort.signal.aborted) setError(e.message); }
    finally { if (generation.current === own) setBusy(false); }
  }
  async function remove() {
    const own = generation.current; setBusy(true); setError('');
    try { await post({ action: 'remove' }); if (generation.current === own) setStatus({ enabled: true, version: null, currentVersionId: null }); }
    catch (e) { if (generation.current === own) setError(e.message); }
    finally { if (generation.current === own) setBusy(false); }
  }
  if (!status || status.enabled === false) return null;
  return <div style={{ marginTop: 16, padding: 12, border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, fontSize: 12 }}>
    <strong>Track visual</strong>
    <p style={{ opacity: .7 }}>Optional silent loop · MP4 / MOV · 7–30 seconds · up to 4K</p>
    <input aria-label="Upload track visual" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" disabled={busy}
      onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
    <p role="status">{busy ? 'Uploading…' : status.version?.status === 'ready' ? 'Visual ready' : status.version?.status ? `Visual ${status.version.status}` : 'No visual uploaded'}</p>
    {(error || status.version?.error_message) && <p role="alert">{error || status.version.error_message}</p>}
    {(status.version || status.currentVersionId) && <button type="button" disabled={busy} onClick={remove}>Remove visual</button>}
  </div>;
}
