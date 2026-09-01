"use client";

import SkeletonBase from "./SkeletonBase";

export default function ImmersiveModalSkeleton({ isMobile = false }) {
  return (
    <div
      className="immersive-modal-skeleton"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(165deg, rgba(14,14,18,0.98) 0%, rgba(6,6,10,0.99) 100%)",
        transition: `opacity var(--motion-duration-slow) var(--motion-ease-out)`,
        padding: isMobile ? "24px 20px" : "32px 28px",
        gap: 20,
      }}
    >
      <SkeletonBase width="100%" height={isMobile ? 220 : 280} borderRadius={16} />
      <SkeletonBase width="55%" height={18} borderRadius={6} />
      <SkeletonBase width="35%" height={12} borderRadius={4} />
      <div style={{ display: "flex", gap: 12, marginTop: "auto" }}>
        <SkeletonBase width={48} height={48} borderRadius="50%" />
        <SkeletonBase width={48} height={48} borderRadius="50%" />
        <SkeletonBase width="100%" height={48} borderRadius={24} style={{ flex: 1 }} />
      </div>
    </div>
  );
}
