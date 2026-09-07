"use client";

import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { resolveCoverMediaType } from "@/lib/media/cover-media-type";
import { VRM } from "@/lib/media/video-resource-manager";
import SkeletonBase from "./SkeletonBase";
import ProgressiveReveal from "./ProgressiveReveal";

// Viewport-gated, decoder-budget-aware — mirrors CoverArt.js's VideoArt so a
// still-loading (skeleton) card never bypasses the same discipline a
// resolved card gets. Do not let this drift from that implementation.
function VideoArt({
  src,
  baseCover,
  width,
  height,
  borderRadius,
  onClick,
  onTouchStart,
  onTouchEnd,
  onLoaded,
  onLoadedMetadata,
  onError,
}) {
  const videoRef = useRef(null);
  const prevSrcRef = useRef(null);
  const inViewRef = useRef(false);

  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el || src === prevSrcRef.current) return;
    prevSrcRef.current = src;
    el.src = src;
    if (inViewRef.current) el.load();
  }, [src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    VRM.register(el, VRM.PRIORITY_NEAR);

    if (typeof IntersectionObserver === "undefined") {
      el.preload = "auto";
      if (el.src) el.load();
      VRM.requestPlay(el, () => el.play().catch(() => {}), () => {
        if (!el.paused) el.pause();
      });
      return () => VRM.unregister(el);
    }

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          inViewRef.current = true;
          el.preload = "auto";
          if (el.readyState === 0 && el.src) el.load();
          VRM.requestPlay(
            el,
            () => { if (el.paused && !el.ended) el.play().catch(() => {}); },
            () => { if (!el.paused) el.pause(); }
          );
        } else {
          inViewRef.current = false;
          VRM.requestPause(el);
          el.preload = "none";
          if (!el.paused) el.pause();
        }
      },
      { rootMargin: "150px 0px", threshold: 0 }
    );
    obs.observe(el);

    return () => {
      obs.disconnect();
      VRM.unregister(el);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      loop
      muted
      playsInline
      preload="none"
      poster={baseCover || undefined}
      onLoadedMetadata={onLoadedMetadata}
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
  onImageLoad,
  onVideoLoadedMetadata,
  onVideoLoadedData,
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
            onLoaded={(event) => {
              setLoaded(true);
              onVideoLoadedData?.(event);
            }}
            onLoadedMetadata={onVideoLoadedMetadata}
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            src={src}
            alt={alt}
            decoding="async"
            draggable={false}
            onLoad={(event) => {
              setLoaded(true);
              onImageLoad?.(event);
            }}
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
