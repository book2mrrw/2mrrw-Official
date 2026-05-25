"use client";

import Link from "next/link";
import { memo } from "react";
import GiftIcon from "@/components/gifts/GiftIcon";
import { giftIconColor } from "@/components/gifts/GiftIcon";
import { paletteToCssVars } from "@/hooks/useCoverPalette";

function CartIcon({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M2 2h4l3 14h13l3-10H8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="13" cy="27" r="2" fill="currentColor" stroke="none" />
      <circle cx="23" cy="27" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SubscribeIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden>
      <path d="M4 20h20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M4 20l3-7 7 4 4-10 4 7 2-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CollectionIcon({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden>
      <path
        d="M6 4h16v18l-8-5-8 5V4z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ModalActionButtons({
  showPurchase,
  showGift,
  priceLabel,
  palette,
  isMobile = false,
  canStream = false,
  owned = false,
  onAddToCart,
  onGift,
}) {
  if (!showPurchase && !showGift && !(isMobile && canStream)) return null;

  if (isMobile) {
    return (
      <div className="modal-immersive-act-row" style={paletteToCssVars(palette)}>
        {showPurchase ? (
          <>
            <button
              type="button"
              className="modal-immersive-act-btn modal-immersive-act-btn--cart"
              aria-label={priceLabel ? `Add to cart ${priceLabel}` : "Add to cart"}
              onClick={onAddToCart}
            >
              <CartIcon />
            </button>
            <Link
              href="/subscribe"
              className="modal-immersive-act-btn modal-immersive-act-btn--subscribe"
              aria-label="Subscribe for unlimited streaming"
            >
              <SubscribeIcon />
            </Link>
          </>
        ) : owned || canStream ? (
          <span className="modal-immersive-act-btn modal-immersive-act-btn--collection" aria-hidden>
            <CollectionIcon />
          </span>
        ) : null}
        {showGift ? (
          <button
            type="button"
            className="modal-immersive-act-btn modal-immersive-act-btn--gift"
            aria-label="Send gift"
            onClick={(e) => {
              e.stopPropagation();
              onGift?.();
            }}
          >
            <GiftIcon size={22} />
          </button>
        ) : null}
      </div>
    );
  }

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
