/** Private storage is a separate bucket, never an obscured prefix in the public CDN. */
export function resolveStorageBucket(storageScope = "public", env = process.env) {
  if (storageScope !== "public" && storageScope !== "private") throw new Error("Invalid media storage scope");
  const publicBucket = String(env.CLOUDFLARE_R2_BUCKET_NAME || "").trim();
  if (storageScope === "public") return publicBucket || undefined;
  const privateBucket = String(env.CLOUDFLARE_R2_PRIVATE_BUCKET_NAME || "").trim();
  if (!publicBucket || !privateBucket || privateBucket === publicBucket) {
    throw new Error("Private media requires a distinct CLOUDFLARE_R2_PRIVATE_BUCKET_NAME");
  }
  return privateBucket;
}

export function releaseStorageScope(release) {
  if (!release) throw new Error("Canonical release is required for media authorization");
  const privateRelease = release.publication_state === "unrelzd" || release.status === "unrelzd";
  if (privateRelease && release.storage_scope !== "private") throw new Error("Private release storage is not configured safely");
  const scope = release.storage_scope || "public";
  if (scope !== "public" && scope !== "private") throw new Error("Invalid media storage scope");
  return scope;
}
