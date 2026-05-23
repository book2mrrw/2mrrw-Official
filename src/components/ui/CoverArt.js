"use client";

export function resolveCoverMediaType(src, type = "image") {
  if (type === "video" || (src && String(src).toLowerCase().endsWith(".mp4"))) {
    return "video";
  }
  return "image";
}

export default function CoverArt({
  src,
  type = "image",
  alt = "",
  width,
  height,
  borderRadius,
  style,
  onClick,
  onTouchStart,
  onTouchEnd,
}) {
  if (!src) return null;

  const mediaType = resolveCoverMediaType(src, type);

  const baseStyle = {
    width: width ?? "100%",
    height: height ?? "100%",
    borderRadius,
    display: "block",
    objectFit: "cover",
    ...style,
  };

  const touchProps = { onClick, onTouchStart, onTouchEnd };

  if (mediaType === "video") {
    return (
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        {...touchProps}
        style={baseStyle}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      {...touchProps}
      style={baseStyle}
    />
  );
}
