"use client";

const GIFT_BTN_STYLE = {
  background: "transparent",
  color: "#a259ff",
  border: "1px solid rgba(162,89,255,0.4)",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  flexShrink: 0,
};

export default function GiftButton({ onClick, style = {}, label = "Gift" }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      style={{ ...GIFT_BTN_STYLE, ...style }}
    >
      {label}
    </button>
  );
}
