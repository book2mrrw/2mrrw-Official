"use client";

import SkeletonBase from "./SkeletonBase";
import TrackCardSkeleton from "./TrackCardSkeleton";

export default function PageSkeleton({ rows = 4 }) {
  return (
    <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <SkeletonBase width="40%" height={22} borderRadius={6} />
      {Array.from({ length: rows }).map((_, i) => (
        <TrackCardSkeleton key={i} />
      ))}
    </div>
  );
}
