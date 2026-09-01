"use client";

import GiftIcon, { giftIconColor } from "@/components/gifts/GiftIcon";

const GIFT_BTN_STYLE = {
  background: "transparent",
  color: giftIconColor,
  border: "1px solid rgba(212, 168, 83, 0.4)",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};

const ICON_ONLY_STYLE = {
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(212, 168, 83, 0.35)",
  borderRadius: 10,
  padding: 6,
  backdropFilter: "blur(6px)",
  boxShadow: "0 0 12px rgba(212, 168, 83, 0.15)",
};

export default function GiftButton({ onClick, style = {}, label = "Gift", iconOnly = false }) {
  const useIcon = iconOnly || label === "🎁";
  return (
    <button
      type="button"
      aria-label="Send gift"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      style={{
        ...GIFT_BTN_STYLE,
        ...(useIcon ? ICON_ONLY_STYLE : {}),
        ...style,
      }}
    >
      {useIcon ? <GiftIcon size={iconOnly ? 18 : 20} /> : label}
    </button>
  );
}
