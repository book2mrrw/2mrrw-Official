"use client";

import SkeletonBase from "./SkeletonBase";

export default function CollectorCardSkeleton() {
  return (
    <div style={{ padding: 16, borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
      <SkeletonBase width="100%" height={160} borderRadius={10} />
      <SkeletonBase width="65%" height={14} borderRadius={4} style={{ marginTop: 12 }} />
    </div>
  );
}
