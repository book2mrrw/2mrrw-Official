import { authorizeBroadcastListener } from "@/lib/broadcast/server-access";
import { resolveBroadcastMedia } from "@/lib/broadcast/server-media";
import { createR2SignedGetUrl } from "@/lib/storage/r2";
import { proxySignedR2Get } from "@/lib/server/r2-stream-proxy";
import { createBroadcastMediaHandler } from "@/lib/broadcast/media-handler";

export const dynamic = "force-dynamic";
const serve = createBroadcastMediaHandler({ authorizeBroadcastListener, resolveBroadcastMedia, createR2SignedGetUrl, proxySignedR2Get });
export const GET = serve;
export const HEAD = serve;
