const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };

/** @type {{ url: string, priority: string, resolve: (v: unknown) => void, reject: (e: Error) => void }[]} */
const queue = [];
let activeLoads = 0;
const MAX_CONCURRENT = 4;

function sortQueue() {
  queue.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
}

function pump(loader) {
  while (activeLoads < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    if (!job) break;
    activeLoads += 1;
    loader(job.url)
      .then((value) => job.resolve(value))
      .catch((err) => job.reject(err instanceof Error ? err : new Error(String(err))))
      .finally(() => {
        activeLoads -= 1;
        pump(loader);
      });
  }
}

export function enqueue(url, priority, loader) {
  return new Promise((resolve, reject) => {
    queue.push({ url, priority: priority || "normal", resolve, reject });
    sortQueue();
    pump(loader);
  });
}

export function clearQueue() {
  queue.length = 0;
}
