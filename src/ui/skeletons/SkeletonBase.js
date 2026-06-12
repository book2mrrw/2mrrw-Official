"use client";

export default function SkeletonBase({
  width = "100%",
  height = "100%",
  borderRadius = 8,
  className = "",
  style = {},
}) {
  return (
    <div
      aria-hidden
      className={`skeleton-base ${className}`.trim()}
      style={{
        width,
        height,
        borderRadius,
        background: "linear-gradient(90deg, rgba(24,24,28,0.95) 0%, rgba(36,36,42,0.95) 50%, rgba(24,24,28,0.95) 100%)",
        backgroundSize: "200% 100%",
        animation: `skeleton-shimmer var(--motion-duration-slow) var(--motion-ease-in-out) infinite`,
        ...style,
      }}
    />
  );
}
