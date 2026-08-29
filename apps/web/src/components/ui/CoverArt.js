"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { imagePipeline } from "@/media/imagePipeline";
import { MARKS, perfMark } from "@/lib/dev/performanceMarks";
import ArtworkSkeleton from "@/ui/skeletons/ArtworkSkeleton";
import { resolveCoverMediaType } from "@/lib/media/cover-media-type";
import { VRM } from "@/lib/media/video-resource-manager";
import { logVisualVideoError, logVisualVideoFallback, logVisualImageError } from "@/lib/media/visual-telemetry";
import { useAudioMediaPriority } from "@/hooks/useAudioMediaPriority";
import { useReleaseCoverLifecycle } from "@/hooks/useReleasePresentation";
import {
  getReleasePresentation,
  recordReleasePresentationEvent,
} from "@/lib/storefront/release-presentation-registry";
export { resolveCoverMediaType };

// Fallback levels for the artwork pipeline
const FL_PRIMARY = 0;    // show primary source (video or image)
const FL_STATIC = 1;     // video failed → show static baseCover
const FL_DARK = 2;       // everything failed → dark placeholder

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
  presentationIdentity = null,
}) {
  // Failure state is keyed to the src that triggered it.
  // When src changes the old failure is automatically ignored — no manual reset needed.
  const [failedSrc, setFailedSrc] = useState(null);
  const [fallbackLevel, setFallbackLevel] = useState(FL_PRIMARY);

  const presentationSnapshot = presentationIdentity
    ? getReleasePresentation(presentationIdentity)
    : null;
  const persistedStaticFallback = Boolean(
    baseCover &&
      presentationSnapshot?.coverReady &&
      presentationSnapshot.coverResolvedUrl === baseCover
  );
  const eff = persistedStaticFallback
    ? FL_STATIC
    : failedSrc === src
      ? fallbackLevel
      : FL_PRIMARY;
  const coverLifecycle = useReleaseCoverLifecycle(presentationIdentity, src);

  const handleVideoError = useCallback(() => {
    if (presentationIdentity?.key && baseCover) {
      recordReleasePresentationEvent(
        { ...presentationIdentity, coverAssetIdentity: src },
        "COVER_REQUEST",
        { url: baseCover, fallbackFor: src }
      );
    }
    setFailedSrc(src);
    setFallbackLevel(FL_STATIC);
    logVisualVideoError({ src, context: "CoverArt" });
    if (baseCover) logVisualVideoFallback({ src, context: "CoverArt" });
  }, [src, baseCover, presentationIdentity]);

  const handleImgError = useCallback(() => {
    setFailedSrc(src);
    setFallbackLevel(FL_DARK);
    logVisualImageError({ src, context: "CoverArt" });
  }, [src]);

  useEffect(() => {
    if (!src || skeleton) return;
    perfMark(MARKS.ARTWORK_DECODE_START);
    imagePipeline.preload(src, loadPriority, { coverArtType: type });
  }, [src, type, skeleton, loadPriority]);

  if (skeleton && src && !presentationSnapshot?.coverReady) {
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
        onImageLoad={coverLifecycle.onImageLoad}
        onVideoLoadedMetadata={coverLifecycle.onVideoLoadedMetadata}
        onVideoLoadedData={coverLifecycle.onVideoLoadedData}
      />
    );
  }

  if (!src || eff === FL_DARK) {
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
    if (eff === FL_STATIC) {
      // Primary video failed — fall back to static baseCover image
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
        <img
          src={baseCover}
          alt={alt}
          decoding="async"
          draggable={false}
          className={className}
          {...touchProps}
          onLoad={(event) => coverLifecycle.onImageLoad(event, baseCover)}
          onError={handleImgError}
          style={baseStyle}
        />
      );
    }

    return (
      <VideoArt
        src={src}
        poster={baseCover || undefined}
        className={className}
        touchProps={touchProps}
        baseStyle={baseStyle}
        onError={handleVideoError}
        onLoadedMetadata={coverLifecycle.onVideoLoadedMetadata}
        onLoadedData={coverLifecycle.onVideoLoadedData}
        retainLoadedSource={Boolean(presentationIdentity?.key)}
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
      onLoad={coverLifecycle.onImageLoad}
      onError={handleImgError}
      style={baseStyle}
    />
  );
}

function VideoArt({
  src,
  poster,
  className,
  touchProps,
  baseStyle,
  onError,
  onLoadedMetadata,
  onLoadedData,
  retainLoadedSource,
}) {
  const videoRef = useRef(null);
  const prevSrcRef = useRef(null);
  const inViewRef = useRef(false);
  const audioPriority = useAudioMediaPriority();
  const audioPriorityRef = useRef(audioPriority.active);

  useLayoutEffect(() => {
    audioPriorityRef.current = audioPriority.active;
  }, [audioPriority.active]);

  // Imperative src update. For offscreen elements, defer el.load() to the
  // IntersectionObserver callback so the browser does not pre-fetch invisible media.
  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (audioPriority.active) {
      VRM.requestPause(el);
      if (!el.paused) el.pause();
      el.preload = "none";
      if (!retainLoadedSource && el.hasAttribute("src")) {
        el.removeAttribute("src");
        el.load();
        prevSrcRef.current = null;
      }
      return;
    }
    if (src === prevSrcRef.current) return;
    prevSrcRef.current = src;
    el.src = src;
    if (inViewRef.current) {
      el.preload = "auto";
      el.load();
      VRM.requestPlay(
        el,
        () => { if (el.paused && !el.ended) el.play().catch(() => {}); },
        () => { if (!el.paused) el.pause(); }
      );
    }
    // Offscreen: IO will call load() when the element enters rootMargin.
  }, [src, audioPriority.active, retainLoadedSource]);

  // Viewport-aware decoder management via VideoResourceManager (VRM).
  // Carousel videos use data-single-carousel and are managed by
  // storefront-persistent-media.js — this observer never touches them.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    VRM.register(el, VRM.PRIORITY_NEAR);

    if (typeof IntersectionObserver === "undefined") {
      // Old-browser fallback: load and request play immediately.
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
          if (audioPriorityRef.current) return;
          el.preload = "auto";
          // Load if src was set while offscreen (readyState 0 = HAVE_NOTHING).
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
      poster={poster || undefined}
      onLoadedMetadata={onLoadedMetadata}
      onLoadedData={onLoadedData}
      onError={onError}
      className={className}
      {...touchProps}
      style={baseStyle}
    />
  );
}

export default memo(CoverArt);
