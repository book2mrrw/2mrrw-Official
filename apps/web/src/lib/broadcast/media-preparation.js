/** Verify bounded delivery, not codec support or audible playback on a listener's device. */
export async function probeBroadcastMedia(media, { sign, fetcher = fetch, signal }) {
  if (!media?.key) return false;
  const url = await sign(media.key, 60, { storageScope: media.storageScope });
  const response = await fetcher(url, {
    headers: { Range: "bytes=0-1023" }, cache: "no-store", redirect: "error", signal,
  });
  try {
    const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
    if (response.status !== 206 || !range || Number(range[1]) > 1023 || Number(range[2]) <= 0 ||
        Number(range[1]) !== Math.min(1023, Number(range[2]) - 1)) return false;
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("audio/") && type !== "application/ogg") return false;
    const reader = response.body?.getReader();
    if (!reader) return false;
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) return false;
      }
      return size === Number(range[1]) + 1;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } finally { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
}

/** Server-only dependencies provide canonical resolution; no request-supplied readiness. */
export async function prepareBroadcastMedia(session, { resolve, sign, fetcher, signal }) {
  const results = [];
  // Bounded concurrency avoids fetching an entire project at once.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, session.items.length) }, async () => {
    while (next < session.items.length) {
      const item = session.items[next++];
      if (signal?.aborted) throw signal.reason || new Error("Preparation cancelled");
      let prepared = false;
      if (!item.excluded && !item.completed) {
        try {
          const media = await resolve(session, item);
          prepared = await probeBroadcastMedia(media, { sign, fetcher, signal });
        } catch (error) { if (signal?.aborted) throw error; }
      }
      results.push({ id: item.id, prepared });
    }
  }));
  return results;
}
