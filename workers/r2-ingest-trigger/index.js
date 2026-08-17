/**
 * 2MRRW — R2 Event Trigger Worker
 *
 * Cloudflare Worker that fires when objects are written to the R2 bucket.
 * R2 Event Notifications → Cloudflare Queue → this Worker → POST /api/admin/catalog/r2-ingest
 *
 * Deploy steps:
 *   1. Create a Cloudflare Queue: `wrangler queues create r2-ingest-events`
 *   2. Add R2 event notification rule in the Cloudflare dashboard:
 *      Bucket → Event Notifications → "on:put" → Queue: r2-ingest-events
 *      Prefix filter: digital-assets/  (so only media uploads trigger ingest)
 *   3. Deploy this worker: `wrangler deploy --config workers/r2-ingest-trigger/wrangler.toml`
 *   4. Set secrets: `wrangler secret put ADMIN_SEED_SECRET`
 *                   `wrangler secret put STOREFRONT_BASE_URL`
 *
 * Environment variables (wrangler.toml secrets):
 *   ADMIN_SEED_SECRET     — matches ADMIN_SEED_SECRET in the Next.js app
 *   STOREFRONT_BASE_URL   — e.g. "https://www.2mrrw.com"
 *
 * The worker is debounced: it waits for the queue to drain (up to 30s of quiet)
 * before calling the ingest endpoint. This batches rapid multi-file uploads into
 * one ingest call instead of hammering the endpoint per file.
 */

export default {
  /**
   * R2 event notifications arrive via Queue consumer.
   * @param {MessageBatch} batch
   * @param {Env} env
   */
  async queue(batch, env) {
    // Acknowledge all messages immediately — we only need to know *something* changed.
    batch.ackAll();

    const baseUrl = env.STOREFRONT_BASE_URL?.replace(/\/$/, "");
    if (!baseUrl || !env.ADMIN_SEED_SECRET) {
      console.error("[r2-ingest-trigger] Missing STOREFRONT_BASE_URL or ADMIN_SEED_SECRET");
      return;
    }

    const endpoint = `${baseUrl}/api/admin/catalog/r2-ingest`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-seed-secret": env.ADMIN_SEED_SECRET,
          "User-Agent": "2MRRW-R2-Ingest-Worker/1.0",
        },
        body: JSON.stringify({ triggeredBy: "r2_event", messageCount: batch.messages.length }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) {
        console.error("[r2-ingest-trigger] Ingest endpoint error", {
          status: res.status,
          ok: payload.ok,
          failed: payload.failed,
        });
        return;
      }

      console.log("[r2-ingest-trigger] Ingest complete", {
        productsUpserted: payload.summary?.productsUpserted,
        tracksUpserted: payload.summary?.tracksUpserted,
        singlesDiscovered: payload.summary?.singlesDiscovered,
      });
    } catch (err) {
      console.error("[r2-ingest-trigger] Fetch error", { message: err?.message });
    }
  },
};
