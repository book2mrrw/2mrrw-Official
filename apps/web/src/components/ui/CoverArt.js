"use client";
/* eslint-disable @next/next/no-img-element -- explicit decoded-image cache and stable DOM layers */

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { imagePipeline } from "@/media/imagePipeline";
import { MARKS, perfMark } from "@/lib/dev/performanceMarks";
import ArtworkSkeleton from "@/ui/skeletons/ArtworkSkeleton";
import { resolveCoverMediaType } from "@/lib/media/cover-media-type";
import { createPersistentVisualLifecycle } from "@/lib/media/persistent-visual-lifecycle";
import {
  logVisualImageError,
  logVisualVideoError,
  logVisualVideoFallback,
} from "@/lib/media/visual-telemetry";

export { resolveCoverMediaType };

const FL_PRIMARY = 0;
const FL_STATIC = 1;
const FL_DARK = 2;

function DarkPlaceholder({ className, width, height, borderRadius, style }) {
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

/** Keep the last paintable image while the next asset identity warms. */
function useReadyImageSource(src, priority = "normal") {
  const [readySrc, setReadySrc] = useState(src || null);
  const requestedSrcRef = useRef(src || null);

  useEffect(() => {
    requestedSrcRef.current = src || null;
    if (!src || src === readySrc) return undefined;

    let cancelled = false;
    imagePipeline
      .preload(src, priority, { coverArtType: "image" })
      .then(() => {
        if (!cancelled && requestedSrcRef.current === src) setReadySrc(src);
      })
      .catch(() => {
        // Preserve the last valid paint. The media error boundary owns fallback.
      });

    return () => {
      cancelled = true;
    };
  }, [priority, readySrc, src]);

  return readySrc;
}

function PersistentImage({
  src,
  alt,
  className,
  touchProps,
  baseStyle,
  onError,
  loadPriority,
}) {
  const readySrc = useReadyImageSource(src, loadPriority);
  if (!readySrc) return null;
  return (
    <img
      src={readySrc}
      alt={alt}
      decoding="async"
      draggable={false}
      className={className}
      {...touchProps}
      onError={onError}
      style={baseStyle}
      data-persistent-media="image"
    />
  );
}

function VideoArt({ src, poster, alt, className, touchProps, baseStyle, onError }) {
  const videoRef = useRef(null);
  const lifecycleRef = useRef(null);
  const initialSrcRef = useRef(src);
  const readyPoster = useReadyImageSource(poster, "high");

  useLayoutEffect(() => {
    const element = videoRef.current;
    if (!element) return undefined;
    const lifecycle = createPersistentVisualLifecycle(element);
    lifecycleRef.current = lifecycle;
    lifecycle.setSource(initialSrcRef.current);
    return () => {
      lifecycle.dispose();
      lifecycleRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    lifecycleRef.current?.setSource(src);
  }, [src]);

  return (
    <div
      className={className}
      {...touchProps}
      style={{
        ...baseStyle,
        position: baseStyle.position ?? "relative",
        overflow: "hidden",
        background: "#1a1a1a",
      }}
      data-persistent-media="video"
    >
      {readyPoster ? (
        <img
          src={readyPoster}
          alt={alt}
          decoding="async"
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: "inherit",
          }}
        />
      ) : null}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        poster={readyPoster || undefined}
        onError={onError}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: "inherit",
          opacity: 0,
          transition: "opacity 180ms ease",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function CoverArt({
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
  skeleton = false,
  loadPriority = "normal",
}) {
  const [failedSrc, setFailedSrc] = useState(null);
  const [fallbackLevel, setFallbackLevel] = useState(FL_PRIMARY);
  const effectiveLevel = failedSrc === src ? fallbackLevel : FL_PRIMARY;

  const handleVideoError = useCallback(() => {
    setFailedSrc(src);
    setFallbackLevel(FL_STATIC);
    logVisualVideoError({ src, context: "CoverArt" });
    if (baseCover) logVisualVideoFallback({ src, context: "CoverArt" });
  }, [baseCover, src]);

  const handleImageError = useCallback(() => {
    setFailedSrc(src);
    setFallbackLevel(FL_DARK);
    logVisualImageError({ src, context: "CoverArt" });
  }, [src]);

  useEffect(() => {
    if (!src || skeleton) return;
    perfMark(MARKS.ARTWORK_DECODE_START);
    imagePipeline.preload(src, loadPriority, { coverArtType: type });
  }, [loadPriority, skeleton, src, type]);

  if (skeleton && src) {
    return (
      <ArtworkSkeleton
        src={src}
        baseCover={baseCover}
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

  if (!src || effectiveLevel === FL_DARK) {
    return (
      <DarkPlaceholder
        className={className}
        width={width}
        height={height}
        borderRadius={borderRadius}
        style={style}
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
    if (effectiveLevel === FL_STATIC) {
      if (!baseCover) {
        return (
          <DarkPlaceholder
            className={className}
            width={width}
            height={height}
            borderRadius={borderRadius}
            style={style}
          />
        );
      }
      return (
        <PersistentImage
          src={baseCover}
          alt={alt}
          className={className}
          touchProps={touchProps}
          baseStyle={baseStyle}
          onError={handleImageError}
          loadPriority="high"
        />
      );
    }

    return (
      <VideoArt
        src={src}
        poster={baseCover || undefined}
        alt={alt}
        className={className}
        touchProps={touchProps}
        baseStyle={baseStyle}
        onError={handleVideoError}
      />
    );
  }

  return (
    <PersistentImage
      src={src}
      alt={alt}
      className={className}
      touchProps={touchProps}
      baseStyle={baseStyle}
      onError={handleImageError}
      loadPriority={loadPriority}
    />
  );
}

function shallowStyleEqual(left, right) {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function coverArtPropsEqual(previous, next) {
  const stableKeys = [
    "src",
    "baseCover",
    "type",
    "alt",
    "width",
    "height",
    "borderRadius",
    "className",
    "skeleton",
    "loadPriority",
    "onClick",
    "onTouchStart",
    "onTouchEnd",
  ];
  return stableKeys.every((key) => previous[key] === next[key]) &&
    shallowStyleEqual(previous.style, next.style);
}

export default memo(CoverArt, coverArtPropsEqual);
