"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { imagePipeline } from "@/media/imagePipeline";
import { MARKS, perfMark } from "@/lib/dev/performanceMarks";
import ArtworkSkeleton from "@/ui/skeletons/ArtworkSkeleton";
import { resolveCoverMediaType } from "@/lib/media/cover-media-type";
import { VRM } from "@/lib/media/video-resource-manager";
import { logVisualVideoError, logVisualVideoFallback, logVisualImageError } from "@/lib/media/visual-telemetry";
import { useAudioMediaPriority } from "@/hooks/useAudioMediaPriority";
import { usePlaybackIdentity } from "@/context/AudioContext";
import { useReleaseCoverLifecycle } from "@/hooks/useReleasePresentation";
import { COVER_SIZES, coverSrcSet } from "@/lib/media/cover-srcset";
import { useCoverReady } from "@/hooks/useCoverReady";
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
  videoPriority = VRM.PRIORITY_NEAR,
  coverSizes = COVER_SIZES,
}) {
  // Failure state is keyed to the src that triggered it.
  // When src changes the old failure is automatically ignored — no manual reset needed.
  const [failedSrc, setFailedSrc] = useState(null);
  const [fallbackLevel, setFallbackLevel] = useState(FL_PRIMARY);

  // Decided once, when this instance first sees `src`, and never re-read while
  // mounted. The registry is shared across every surface showing the release
  // and changes without notifying this component, so reading it each render
  // let an unrelated re-render flip `eff` to FL_STATIC mid-life — unmounting
  // VideoArt and mounting an <img> in its place. That is the same remount the
  // skeleton branch below documents. A persisted fallback is still honoured
  // for an instance that mounts after it was recorded.
  const [mountFallback] = useState(() => {
    const presentationSnapshot = presentationIdentity
      ? getReleasePresentation(presentationIdentity)
      : null;
    return {
      src,
      isStatic: Boolean(
        baseCover &&
          presentationSnapshot?.coverReady &&
          presentationSnapshot.coverResolvedUrl === baseCover
      ),
    };
  });
  const persistedStaticFallback = mountFallback.src === src && mountFallback.isStatic;
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

  // Resolved before the early returns below so the readiness hook is
  // unconditional. Pure function of `src`/`type`, so moving it up changes
  // nothing about what it computes.
  const mediaType = resolveCoverMediaType(src, type);

  // The one <img> this component may own: the static fallback after a motion
  // cover failed, otherwise the primary image source. Exactly one is ever live,
  // so a single readiness subscription covers both branches.
  const ownedImageSrc =
    mediaType === "video" ? (eff === FL_STATIC ? baseCover : null) : src;

  // Depend on the memoized callback rather than the lifecycle object, which is
  // rebuilt every render — a changing ref identity would re-attach on every
  // pass for no benefit.
  const { onImageLoad } = coverLifecycle;
  const handleImageReady = useCallback(
    (element, resolvedSrc) => onImageLoad({ currentTarget: element }, resolvedSrc),
    [onImageLoad]
  );

  // Element-state readiness. A static cover routinely finishes loading before
  // React hydrates, and the `load` event it fired then is gone for good, so
  // reading the element is the only way this can be reported at all.
  const { attach: attachCoverImage } = useCoverReady({
    src: ownedImageSrc,
    kind: "image",
    onReady: handleImageReady,
    onFailed: handleImgError,
  });

  // Deliberately NOT gated on presentationSnapshot?.coverReady.
  //
  // It used to be. That was safe only by accident: coverReady could never
  // become true, because the sole thing that set it was a React onLoad handler
  // attached after the image had already finished loading, so the event was
  // always dropped. The condition was permanently true and this branch never
  // moved.
  //
  // Making readiness real (useCoverReady) switched that flag on for the first
  // time, and the branch then flipped mid-life: ArtworkSkeleton unmounted and a
  // different <img> mounted in its place, on every card, moments after load.
  // A remount inside the release card subtree swallows the first press on the
  // play button — press, nothing, press again.
  //
  // Whichever element this component starts with, it keeps. The reveal is
  // handled inside ArtworkSkeleton by opacity, never by swapping branches.
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
        onImageLoad={coverLifecycle.onImageLoad}
        onVideoLoadedMetadata={coverLifecycle.onVideoLoadedMetadata}
        onVideoLoadedData={coverLifecycle.onVideoLoadedData}
        coverSizes={coverSizes}
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
          ref={attachCoverImage}
          src={baseCover}
          srcSet={coverSrcSet(baseCover) || undefined}
          sizes={coverSizes}
          alt={alt}
          decoding="async"
          draggable={false}
          className={className}
          {...touchProps}
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
        releaseId={presentationIdentity?.releaseId || null}
        priority={videoPriority}
      />
    );
  }

  return (
    <img
      ref={attachCoverImage}
      src={src}
      srcSet={coverSrcSet(src) || undefined}
      sizes={coverSizes}
      alt={alt}
      decoding="async"
      draggable={false}
      className={className}
      {...touchProps}
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
  releaseId,
  priority = VRM.PRIORITY_NEAR,
}) {
  const videoRef = useRef(null);
  const prevSrcRef = useRef(null);
  const inViewRef = useRef(false);
  const audioPriority = useAudioMediaPriority();
  const { currentTrackId, currentTrackSlug } = usePlaybackIdentity();
  // Only the release actually playing is exempt from suspension — every other
  // release's cover art yields. With no releaseId (non-home-page callers,
  // presentationIdentity absent), this is always false, so shouldSuspend
  // reduces to the prior blanket audioPriority.active behavior unchanged.
  const isThisReleasePlaying = Boolean(releaseId && currentTrackId && currentTrackSlug === releaseId);
  const shouldSuspend = audioPriority.active && !isThisReleasePlaying;
  const shouldSuspendRef = useRef(shouldSuspend);

  useLayoutEffect(() => {
    shouldSuspendRef.current = shouldSuspend;
  }, [shouldSuspend]);

  // Imperative src update. For offscreen elements, defer el.load() to the
  // IntersectionObserver callback so the browser does not pre-fetch invisible media.
  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (shouldSuspend) {
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
    // Not suspended — ensure src is current, then always (re)request play when
    // in view. A resume from suspension with retainLoadedSource leaves `src`
    // unchanged, so "src unchanged" must never short-circuit re-requesting
    // play, or a cover that yielded would never come back on its own.
    if (src !== prevSrcRef.current) {
      prevSrcRef.current = src;
      el.src = src;
    }
    if (inViewRef.current) {
      el.preload = "auto";
      if (el.readyState === 0 && el.src) el.load();
      VRM.requestPlay(
        el,
        () => { if (el.paused && !el.ended) el.play().catch(() => {}); },
        () => { if (!el.paused) el.pause(); }
      );
    }
    // Offscreen: IO will call load() when the element enters rootMargin.
  }, [src, shouldSuspend, retainLoadedSource]);

  // Viewport-aware decoder management via VideoResourceManager (VRM).
  // Carousel videos use data-single-carousel and are managed by
  // storefront-persistent-media.js — this observer never touches them.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    VRM.register(el, priority);

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
          if (shouldSuspendRef.current) return;
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
    // `priority` is a static per-instance choice (PRIORITY_NEAR vs
    // PRIORITY_HERO) — this must register once on mount, not re-run the
    // observer/VRM registration if a caller's constant were ever swapped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
