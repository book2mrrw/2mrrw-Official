"use client";

import SkeletonBase from "./SkeletonBase";

export default function TrackCardSkeleton() {
  return (
    <div style={{ display: "flex", gap: 12, padding: "10px 0" }}>
      <SkeletonBase width={56} height={56} borderRadius={8} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
        <SkeletonBase width="70%" height={14} borderRadius={4} />
        <SkeletonBase width="45%" height={10} borderRadius={4} />
      </div>
    </div>
  );
}
