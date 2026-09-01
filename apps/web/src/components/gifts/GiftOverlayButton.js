"use client";

import GiftButton from "@/components/gifts/GiftButton";

/** Top-right floating gift control (admin gifting). */
export default function GiftOverlayButton({ onClick, style = {} }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 10,
        ...style,
      }}
    >
      <GiftButton onClick={onClick} iconOnly />
    </div>
  );
}
