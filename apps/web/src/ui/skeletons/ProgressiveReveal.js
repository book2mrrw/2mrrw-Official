"use client";

export default function ProgressiveReveal({
  children,
  visible = true,
  delay = 0,
  duration,
  staggerMs = 0,
  className = "",
  style = {},
}) {
  const dur = duration ?? "var(--motion-duration-base)";
  const transitionDelay = staggerMs ? `${delay + staggerMs}ms` : `${delay}ms`;

  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity ${dur} var(--motion-ease-out)`,
        transitionDelay,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
