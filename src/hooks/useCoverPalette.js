"use client";

import { useEffect, useState } from "react";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";

const FALLBACK_PRIMARY = [0, 220, 210];
const FALLBACK_SECONDARY = [100, 72, 180];

/** Monochrome luxury fallback — platinum + warm charcoal */
const MONO_PRIMARY = [210, 208, 202];
const MONO_SECONDARY = [138, 136, 128];

const MOTION_EXT_RE = /\.(mp4|webm|gif)(\?|#|$)/i;

export function isMotionCoverMedia(src, type = "image") {
  if (type === "video" || type === "motion") return true;
  return MOTION_EXT_RE.test(String(src || ""));
}

function rgbToCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function rgbToGlow([r, g, b], alpha = 0.42) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function colorDistance(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function saturation([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min;
}

function isMonochromePalette(primary, swatches = []) {
  const samples = [primary, ...swatches].filter(Boolean);
  if (!samples.length) return false;
  const lowSat = samples.every((c) => saturation(c) < 22);
  const graySpread =
    Math.max(...samples.map((c) => c[0])) - Math.min(...samples.map((c) => c[0])) < 48;
  return lowSat && graySpread;
}

function pickSecondary(primary, swatches) {
  return (
    swatches.find((c) => colorDistance(c, primary) > 48) ||
    swatches[1] ||
    [
      Math.min(255, primary[0] + 36),
      Math.max(0, primary[1] - 28),
      Math.min(255, primary[2] + 48),
    ]
  );
}

export function isVideoCoverFile(src) {
  return /\.(mp4|webm)(\?|#|$)/i.test(String(src || ""));
}

function blendRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function buildPalette(primary, secondary, { monochrome = false, animated = false } = {}) {
  const ambient = blendRgb(primary, secondary, 0.45);
  const edge = blendRgb(primary, [8, 8, 12], 0.35);

  return {
    primary,
    secondary,
    ambient,
    monochrome,
    animated,
    primaryCss: rgbToCss(primary),
    secondaryCss: rgbToCss(secondary),
    ambientTintCss: rgbToCss(ambient),
    primaryGlow: rgbToGlow(primary, 0.44),
    secondaryGlow: rgbToGlow(secondary, 0.3),
    primaryMuted: rgbToGlow(primary, 0.14),
    secondaryMuted: rgbToGlow(secondary, 0.1),
    ambientTint: rgbToGlow(ambient, 0.18),
    edgeGlow: rgbToGlow(edge, 0.52),
    gradientTop: rgbToGlow(primary, 0.22),
    gradientBottom: rgbToGlow(secondary, 0.16),
    accentOutline: rgbToGlow(primary, 0.38),
    titleGlow: rgbToGlow(primary, 0.35),
  };
}

export const DEFAULT_PALETTE = buildPalette(FALLBACK_PRIMARY, FALLBACK_SECONDARY);

export function paletteToCssVars(palette) {
  const p = palette || DEFAULT_PALETTE;
  return {
    ["--modal-accent"]: p.primaryCss,
    ["--modal-accent-secondary"]: p.secondaryCss,
    ["--modal-ambient-tint"]: p.ambientTintCss,
    ["--modal-accent-glow"]: p.primaryGlow,
    ["--modal-secondary-glow"]: p.secondaryGlow,
    ["--modal-accent-muted"]: p.primaryMuted,
    ["--modal-secondary-muted"]: p.secondaryMuted,
    ["--modal-ambient-glow"]: p.ambientTint,
    ["--modal-edge-glow"]: p.edgeGlow,
    ["--modal-gradient-top"]: p.gradientTop,
    ["--modal-gradient-bottom"]: p.gradientBottom,
    ["--modal-accent-outline"]: p.accentOutline,
    ["--modal-title-glow"]: p.titleGlow,
    /* Prototype scene aliases (cover-derived, not a theme catalog) */
    ["--p1"]: p.primaryCss,
    ["--p2"]: p.secondaryCss,
    ["--accent"]: p.primaryCss,
    ["--glow"]: p.primaryGlow,
    ["--glow-dim"]: p.primaryMuted,
    ["--modal-scene-dark"]: p.ambientTintCss,
  };
}

async function loadColorThief() {
  const { default: ColorThief } = await import("colorthief");
  return new ColorThief();
}

async function extractFromImageElement(img, animated) {
  const thief = await loadColorThief();
  const primary = thief.getColor(img);
  const swatches = thief.getPalette(img, 6) || [];
  const monochrome = isMonochromePalette(primary, swatches);

  if (monochrome) {
    return buildPalette(MONO_PRIMARY, MONO_SECONDARY, { monochrome: true, animated });
  }

  return buildPalette(primary, pickSecondary(primary, swatches), { animated });
}

async function extractFromImageUrl(url, animated) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;

  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("cover load failed"));
  });

  return extractFromImageElement(img, animated);
}

async function extractFromVideoUrl(url, animated) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  await new Promise((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("video load failed"));
  });

  if (video.videoWidth > 0) {
    video.currentTime = Math.min(0.12, video.duration > 0 ? video.duration * 0.05 : 0.12);
    await new Promise((resolve) => {
      video.onseeked = () => resolve();
    });
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, video.videoWidth || 64);
  canvas.height = Math.max(1, video.videoHeight || 64);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);

  const img = new Image();
  img.src = canvas.toDataURL("image/jpeg", 0.82);
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("video frame decode failed"));
  });

  video.removeAttribute("src");
  video.load();

  return extractFromImageElement(img, animated);
}

/**
 * Extract dominant colors from cover art for modal ambience (colorthief).
 * Supports static images, GIF, and video/mp4/WebM frame sampling.
 */
export function useCoverPalette(coverSrc, coverType = "image") {
  const [palette, setPalette] = useState(DEFAULT_PALETTE);

  useEffect(() => {
    const animated = isMotionCoverMedia(coverSrc, coverType);

    if (!coverSrc) {
      setPalette(DEFAULT_PALETTE);
      return undefined;
    }

    const url = resolveAbsoluteArtworkUrl(coverSrc);
    if (!url || url.startsWith("blob:")) {
      setPalette(buildPalette(FALLBACK_PRIMARY, FALLBACK_SECONDARY, { animated }));
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const next = isVideoCoverFile(coverSrc) || coverType === "video"
          ? await extractFromVideoUrl(url, true).catch(() => extractFromImageUrl(url, true))
          : await extractFromImageUrl(url, animated);

        if (!cancelled) setPalette(next);
      } catch {
        if (!cancelled) {
          setPalette(buildPalette(FALLBACK_PRIMARY, FALLBACK_SECONDARY, { animated }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coverSrc, coverType]);

  return palette;
}
