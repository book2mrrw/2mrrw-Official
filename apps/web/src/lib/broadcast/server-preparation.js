import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";
import { createR2SignedGetUrl } from "@/lib/storage/r2";
import { resolveBroadcastMedia } from "./server-media";
import { prepareBroadcastMedia } from "./media-preparation";

export function prepareServerBroadcastMedia(session) {
  const client = getAdminClient();
  return prepareBroadcastMedia(session, {
    resolve: (snapshot, item) => resolveBroadcastMedia(client, snapshot, item),
    sign: createR2SignedGetUrl,
    signal: AbortSignal.timeout(20000),
  });
}
