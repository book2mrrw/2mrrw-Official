"use client";

import { useCallback, useState, useRef, useLayoutEffect, useEffect } from "react";
import { resolveCoverMediaType } from "@/lib/media/cover-media-type";
import { imagePipeline } from "@/media/imagePipeline";
import { VRM } from "@/lib/media/video-resource-manager";
import { isMediaElementReady } from "@/lib/media/element-readiness";
import { COVER_SIZES, coverSrcSet } from "@/lib/media/cover-srcset";
import { useCoverReady } from "@/hooks/useCoverReady";
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

    // A re-attached element can already hold a decoded frame, and `loadeddata`
    // will not fire a second time for it. Read the element rather than waiting
    // for an event that has already been dispatched.
    if (isMediaElementReady(el, "video")) onLoaded?.({ currentTarget: el });

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
    // Registers the decoder budget observer once on mount — re-running it on a
    // changed `onLoaded` identity would tear down and rebuild the observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  coverSizes = COVER_SIZES,
}) {
  const mediaType = resolveCoverMediaType(src, type);
  const isVideo = mediaType === "video";

  // Video keeps its own event-driven state: its load is deliberately deferred
  // to an IntersectionObserver inside an effect, so it cannot settle before
  // this component's handlers exist. VideoArt above additionally reads element
  // state on attach, which covers a re-attached, already-decoded element.
  const [videoLoadedSrc, setVideoLoadedSrc] = useState(null);
  const [videoFailedSrc, setVideoFailedSrc] = useState(null);

  const handleImageReady = useCallback(
    (element, resolvedSrc) => onImageLoad?.({ currentTarget: element }, resolvedSrc),
    [onImageLoad]
  );

  // Images can and routinely do settle before hydration, so they are gated on
  // element state rather than on an event that may already have been missed.
  const { ready: imageReady, failed: imageFailed, attach: attachImage } = useCoverReady({
    src: isVideo ? null : src,
    kind: "image",
    onReady: handleImageReady,
  });

  // A decoded entry in the shared pipeline is an equally valid proof that the
  // bytes are in memory, so it stays as a second state source. What it is no
  // longer allowed to be is the *only* non-event source of readiness.
  const pipelineDecoded = Boolean(
    mediaType !== "video" && imagePipeline.getFromCache(src, { coverArtType: type })
  );

  const loaded = isVideo ? videoLoadedSrc === src : imageReady || pipelineDecoded;
  const failed = isVideo ? videoFailedSrc === src : imageFailed;

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
      {!loaded && !(mediaType === "video" && baseCover) ? (
        <SkeletonBase
          width="100%"
          height="100%"
          borderRadius={borderRadius}
          style={{ position: "absolute", inset: 0 }}
        />
      ) : null}
      <ProgressiveReveal
        visible={loaded || mediaType !== "video" || Boolean(baseCover)}
        style={{ position: "relative" }}
      >
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
              setVideoLoadedSrc(src);
              onVideoLoadedData?.(event);
            }}
            onLoadedMetadata={onVideoLoadedMetadata}
            onError={() => setVideoFailedSrc(src)}
          />
        ) : (
          <img
            ref={attachImage}
            src={src}
            srcSet={coverSrcSet(src) || undefined}
            sizes={coverSizes}
            alt={alt}
            decoding="async"
            draggable={false}
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
