"use client";

import { useState } from "react";
import CoverArt, { resolveCoverMediaType } from "@/components/ui/CoverArt";
import SkeletonBase from "./SkeletonBase";
import ProgressiveReveal from "./ProgressiveReveal";

export default function ArtworkSkeleton({
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
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const mediaType = resolveCoverMediaType(src, type);

  if (!src || failed) {
    return (
      <SkeletonBase
        width={width ?? "100%"}
        height={height ?? "100%"}
        borderRadius={borderRadius}
        className={className}
        style={{ aspectRatio: "1 / 1", ...style }}
      />
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: width ?? "100%",
        height: height ?? "100%",
        aspectRatio: "1 / 1",
        ...style,
      }}
      className={className}
    >
      {!loaded ? (
        <SkeletonBase
          width="100%"
          height="100%"
          borderRadius={borderRadius}
          style={{ position: "absolute", inset: 0 }}
        />
      ) : null}
      <ProgressiveReveal visible={loaded}>
        {mediaType === "video" ? (
          <CoverArt
            src={src}
            type={type}
            alt={alt}
            width="100%"
            height="100%"
            borderRadius={borderRadius}
            onClick={onClick}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          />
        ) : (
          <img
            src={src}
            alt={alt}
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            onClick={onClick}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            style={{
              width: "100%",
              height: "100%",
              borderRadius,
              objectFit: "cover",
              display: "block",
              opacity: loaded ? 1 : 0,
              transition: `opacity var(--motion-duration-base) var(--motion-ease-out)`,
            }}
          />
        )}
      </ProgressiveReveal>
    </div>
  );
}
