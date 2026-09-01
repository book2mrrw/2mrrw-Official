/**
 * Wraps async work with abort/mounted/stale guards — never throws to caller.
 *
 * @template T
 * @param {() => Promise<T>} asyncFn
 * @param {{ signal?: AbortSignal, isMounted?: () => boolean, isStale?: (v: number) => boolean, version?: number }} guards
 * @returns {Promise<{ data?: T, error?: Error, cancelled?: boolean }>}
 */
export async function safeAsync(asyncFn, { signal, isMounted, isStale, version } = {}) {
  if (signal?.aborted) return { cancelled: true };
  if (isMounted && !isMounted()) return { cancelled: true };
  if (isStale && version != null && isStale(version)) return { cancelled: true };

  try {
    const data = await asyncFn();
    if (signal?.aborted) return { cancelled: true };
    if (isMounted && !isMounted()) return { cancelled: true };
    if (isStale && version != null && isStale(version)) return { cancelled: true };
    return { data };
  } catch (error) {
    if (signal?.aborted) return { cancelled: true };
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}
