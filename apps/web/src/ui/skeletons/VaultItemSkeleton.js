"use client";

import SkeletonBase from "./SkeletonBase";

export default function VaultItemSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SkeletonBase width="100%" height={140} borderRadius={10} />
      <SkeletonBase width="80%" height={12} borderRadius={4} />
    </div>
  );
}
