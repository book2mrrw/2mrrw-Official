export function resolveCoverMediaType(src, type = "image") {
  if (type === "video" || type === "motion") return "video";
  const s = String(src || "").toLowerCase();
  if (/\.(mp4|webm)(\?|#|$)/.test(s)) return "video";
  return "image";
}
