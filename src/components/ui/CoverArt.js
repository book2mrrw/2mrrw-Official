"use client";

import { useEffect } from "react";
import { imagePipeline } from "@/media/imagePipeline";
import { MARKS, perfMark } from "@/lib/dev/performanceMarks";
import ArtworkSkeleton from "@/ui/skeletons/ArtworkSkeleton";

export function resolveCoverMediaType(src, type = "image") {
  if (type === "video" || type === "motion") return "video";
  const s = String(src || "").toLowerCase();
  if (/\.(mp4|webm)(\?|#|$)/.test(s)) return "video";
  return "image";
}

export default function CoverArt({
  src,
  type = "image",
  alt = "",
  width,
  height,
  borderRadius,
  className,
  style,
  onClick,
  onTouchStart,
  onTouchEnd,
  skeleton = false,
}) {
  useEffect(() => {
    if (!src || skeleton) return;
    perfMark(MARKS.ARTWORK_DECODE_START);
    imagePipeline.preload(src, "normal", { coverArtType: type });
  }, [src, type, skeleton]);

  if (skeleton && src) {
    return (
      <ArtworkSkeleton
        src={src}
        type={type}
        alt={alt}
        width={width}
        height={height}
        borderRadius={borderRadius}
        className={className}
        style={style}
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      />
    );
  }
  if (!src) {
    return (
      <div
        aria-hidden
        className={className}
        style={{
          width: width ?? "100%",
          height: height ?? "100%",
          borderRadius,
          background: "#1a1a1a",
          ...style,
        }}
      />
    );
  }

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
        className={className}
        {...touchProps}
        style={baseStyle}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      decoding="async"
      draggable={false}
      className={className}
      {...touchProps}
      style={baseStyle}
    />
  );
}
