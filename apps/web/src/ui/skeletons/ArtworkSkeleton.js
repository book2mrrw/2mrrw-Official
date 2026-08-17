"use client";

import { useState, useRef, useLayoutEffect } from "react";
import { resolveCoverMediaType } from "@/lib/media/cover-media-type";
import SkeletonBase from "./SkeletonBase";
import ProgressiveReveal from "./ProgressiveReveal";

function VideoArt({ src, baseCover, width, height, borderRadius, onClick, onTouchStart, onTouchEnd, onLoaded, onError }) {
  const videoRef = useRef(null);
  const prevSrcRef = useRef(null);

  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el || src === prevSrcRef.current) return;
    prevSrcRef.current = src;
    el.src = src;
    el.load();
  }, [src]);

  return (
    <video
      ref={videoRef}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      poster={baseCover || undefined}
      onCanPlay={onLoaded}
      onError={onError}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        width: width ?? "100%",
        height: height ?? "100%",
        borderRadius,
        display: "block",
        objectFit: "cover",
      }}
    />
  );
}

export default function ArtworkSkeleton({
  src,
  baseCover,
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
          <VideoArt
            src={src}
            baseCover={baseCover}
            width="100%"
            height="100%"
            borderRadius={borderRadius}
            onClick={onClick}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onLoaded={() => setLoaded(true)}
            onError={() => setFailed(true)}
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
