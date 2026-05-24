"use client";

import { memo } from "react";
import GiftIcon from "@/components/gifts/GiftIcon";
import { giftIconColor } from "@/components/gifts/GiftIcon";
import { paletteToCssVars } from "@/hooks/useCoverPalette";

function ModalActionButtons({
  showPurchase,
  showGift,
  priceLabel,
  palette,
  onAddToCart,
  onGift,
}) {
  if (!showPurchase && !showGift) return null;

  return (
    <div className="modal-immersive-actions" style={paletteToCssVars(palette)}>
      {showPurchase ? (
        <button
          type="button"
          className="modal-immersive-action-card modal-immersive-action-card--cart"
          onClick={onAddToCart}
        >
          <span className="modal-immersive-action-card__label">Add to Cart</span>
          {priceLabel ? <span className="modal-immersive-action-card__sub">{priceLabel}</span> : null}
        </button>
      ) : null}
      {showGift ? (
        <button
          type="button"
          className="modal-immersive-action-card modal-immersive-action-card--gift"
          aria-label="Send gift"
          onClick={(e) => {
            e.stopPropagation();
            onGift?.();
          }}
        >
          <GiftIcon size={20} />
          <span className="modal-immersive-action-card__label" style={{ color: giftIconColor }}>
            Gift
          </span>
        </button>
      ) : null}
    </div>
  );
}

export default memo(ModalActionButtons);
