import { discoverFileByExtensions } from "@/lib/storage/r2";

const AUDIO_EXTENSIONS = [".wav", ".flac", ".aiff", ".aif", ".m4a", ".mp3"];

const RELEASE_TYPE_FOLDERS = Object.freeze({
  single: "singles",
  singles: "singles",
  feature: "features",
  features: "features",
  album: "albums",
  albums: "albums",
  ep: "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
  "mixtapes-and-eps": "mixtapes-and-eps",
});

export function masterRevisionReleaseFolder(releaseType) {
  return RELEASE_TYPE_FOLDERS[String(releaseType || "").toLowerCase()] || null;
}

export function slugifyMasterRevisionPart(value, fallback = "track") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export function buildMasterRevisionKeys({ folder, releaseSlug, trackSlug, revisionId, extension }) {
  const trackPart = trackSlug ? `${trackSlug}/` : "";
  const revisionPart = `revisions/${revisionId}/`;
  return {
    stagedMasterKey:
      `digital-assets/${folder}/${releaseSlug}/${trackPart}${revisionPart}master.${extension}`,
    // Keep revision outputs outside the legacy canonical HLS prefix. Otherwise
    // retiring `hls/<type>/<slug>/` could recursively delete the active revision.
    hlsPrefix:
      `hls-revisions/${folder}/${releaseSlug}/${trackPart}${revisionPart}`,
  };
}

async function discoverCurrentMaster(storagePath, metadata) {
  const explicit = String(metadata?.audio_key || "").replace(/^\//, "");
  if (explicit) return explicit;
  const folder = String(storagePath || "").replace(/^\//, "").replace(/\/$/, "");
  if (!folder) return null;
  return discoverFileByExtensions(folder, AUDIO_EXTENSIONS);
}

/** Resolve one stable release/track entity without trusting client slugs or paths. */
export async function resolveMasterRevisionTarget(admin, releaseRefId, requestedTrackId) {
  const { data: release } = await admin
    .from("releases")
    .select("id, slug, release_type, status")
    .eq("id", releaseRefId)
    .maybeSingle();

  if (release) {
    let query = admin
      .from("tracks")
      .select("id, title, position, audio_r2_key, master_r2_key")
      .eq("release_id", release.id)
      .order("position", { ascending: true });
    if (requestedTrackId) query = query.eq("id", requestedTrackId);
    const { data: tracks, error: tracksError } = await query;
    if (tracksError) throw new Error(`Could not resolve release tracks: ${tracksError.message}`);
    if (!tracks?.length) throw new MasterRevisionTargetError("Track not found for this release", 404);
    if (tracks.length !== 1) {
      throw new MasterRevisionTargetError("Select exactly one track to replace", 409);
    }

    const track = tracks[0];
    const isMultiTrack = ["album", "ep", "mixtape"].includes(release.release_type);
    let trackSlug = null;
    let previousStoragePath = null;
    if (isMultiTrack) {
      const { data: projection } = await admin
        .from("catalog_tracks")
        .select("slug, storage_path")
        .eq("track_id", track.id)
        .maybeSingle();
      trackSlug = projection?.slug || slugifyMasterRevisionPart(track.title, `track-${track.position || 1}`);
      previousStoragePath = projection?.storage_path || null;
    } else {
      const { data: productProjection } = await admin
        .from("products")
        .select("storage_path")
        .eq("release_id", release.id)
        .maybeSingle();
      previousStoragePath = productProjection?.storage_path || null;
    }

    const folder = masterRevisionReleaseFolder(release.release_type);
    if (!folder) throw new MasterRevisionTargetError("Unsupported release type", 422);
    return {
      releaseRefId: release.id,
      releaseSource: "releases",
      entityKind: "track",
      entityId: track.id,
      releaseSlug: release.slug,
      trackSlug,
      releaseType: folder,
      previousMasterKey: track.audio_r2_key || track.master_r2_key || null,
      previousStoragePath,
      isPublic: release.status !== "draft",
    };
  }

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id, slug, product_type, release_type, active, storage_path, metadata")
    .eq("id", releaseRefId)
    .maybeSingle();
  if (productError || !product) {
    throw new MasterRevisionTargetError("Release not found", 404);
  }

  const folder = masterRevisionReleaseFolder(product.release_type || product.product_type);
  if (!folder) throw new MasterRevisionTargetError("Unsupported release type", 422);
  const isMultiTrack = folder === "albums" || folder === "mixtapes-and-eps";

  if (isMultiTrack) {
    if (!requestedTrackId) {
      throw new MasterRevisionTargetError("Select exactly one track to replace", 409);
    }
    const { data: track, error: trackError } = await admin
      .from("catalog_tracks")
      .select("id, slug, storage_path, metadata")
      .eq("id", requestedTrackId)
      .eq("product_id", product.id)
      .maybeSingle();
    if (trackError || !track) {
      throw new MasterRevisionTargetError("Track not found for this release", 404);
    }
    return {
      releaseRefId: product.id,
      releaseSource: "catalog",
      entityKind: "catalog_track",
      entityId: track.id,
      releaseSlug: product.slug,
      trackSlug: track.slug,
      releaseType: folder,
      previousMasterKey: await discoverCurrentMaster(track.storage_path, track.metadata),
      previousStoragePath: track.storage_path || null,
      isPublic: Boolean(product.active),
    };
  }

  return {
    releaseRefId: product.id,
    releaseSource: "catalog",
    entityKind: "product",
    entityId: product.id,
    releaseSlug: product.slug,
    trackSlug: null,
    releaseType: folder,
    previousMasterKey: await discoverCurrentMaster(product.storage_path, product.metadata),
    previousStoragePath: product.storage_path || null,
    isPublic: Boolean(product.active),
  };
}

export class MasterRevisionTargetError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "MasterRevisionTargetError";
    this.status = status;
  }
}
