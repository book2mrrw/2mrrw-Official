import { broadcastMediaItem } from "./access-policy.js";
import { BroadcastServiceError, validBroadcastId } from "./command-service.js";

export function createBroadcastMediaHandler({ authorizeBroadcastListener, resolveBroadcastMedia, createR2SignedGetUrl, proxySignedR2Get }) {
return async function serve(req, { params }) {
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) throw new BroadcastServiceError("Origin denied", 403);
    const { client, session, admin } = await authorizeBroadcastListener(req, (await params).id);
    const itemId = new URL(req.url).searchParams.get("itemId");
    if (!validBroadcastId(itemId)) throw new BroadcastServiceError("Media unavailable", 404);
    const item = broadcastMediaItem(session, itemId, { admin });
    if (!item) throw new BroadcastServiceError("Media unavailable", 403);
    const media = await resolveBroadcastMedia(client, session, item);
    if (!media) throw new BroadcastServiceError("Media is not ready", 409);
    const signed = await createR2SignedGetUrl(media.key, 60, { storageScope: media.storageScope });
    const result = await proxySignedR2Get(req, signed, { cacheControl: "private, no-store", opaqueErrors: true });
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  } catch (error) {
    const status = error instanceof BroadcastServiceError ? error.status : 503;
    const body = { error: error instanceof BroadcastServiceError ? error.message : "Media unavailable" };
    return req.method === "HEAD" ? new Response(null, { status, headers: { "Cache-Control": "private, no-store" } })
      : Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  }
};
}
