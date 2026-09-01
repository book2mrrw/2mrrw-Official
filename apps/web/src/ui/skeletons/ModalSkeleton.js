"use client";

import SkeletonBase from "./SkeletonBase";

export default function ModalSkeleton() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <SkeletonBase width="60%" height={20} borderRadius={6} />
      <SkeletonBase width="40%" height={12} borderRadius={4} />
      <SkeletonBase width="100%" height={120} borderRadius={12} />
      <SkeletonBase width="100%" height={44} borderRadius={10} />
    </div>
  );
}
