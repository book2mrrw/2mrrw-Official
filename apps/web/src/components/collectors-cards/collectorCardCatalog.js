import { visualDiscoveryUrl } from "@/lib/media/canonical-paths";

/** Static catalog for /collectors-cards — artwork paths match site albums. */

export const COLLECTOR_CARD_BENEFITS = [
  "Hand Signed",
  "Acrylic Casing",
  "Full Access Digital Streaming",
  "Access to Vault",
  "Access to Future Events",
  "Shop Discounts",
  "Put it near the top of your phone",
  "Collectors Cards Packaging",
];

export const COLLECTOR_CARDS_CATALOG = [
  {
    id: "tbh",
    slug: "exc-card-tbh",
    title: "T.B.H",
    modalTitle: "T.B.H Collector Card",
    price: 89.99,
    editionSize: 200,
    accentColor: "#00ffff",
    artwork: "/images/albums/tbh.jpg",
    faceType: "image",
  },
  {
    id: "ad",
    slug: "exc-card-ad",
    title: "2MRRW: (A.D)",
    modalTitle: "2MRRW: (A.D) Collector Card",
    price: 99.99,
    editionSize: 200,
    accentColor: "#ff6b35",
    artwork: "/images/albums/ad.JPG",
    faceType: "image",
  },
  {
    id: "lovehz",
    slug: "exc-card-lovehz",
    title: "Love Hz Vol.1",
    modalTitle: "Love Hz Vol.1 Collector Card",
    price: 129.99,
    editionSize: 100,
    accentColor: "#a259ff",
    artwork: visualDiscoveryUrl("ep", "love-hz-vol-1", {
      legacyImage: "images/mixtapes-and-eps/love-hz-vol-1/lovehz.jpg",
    }),
    videoSrc: visualDiscoveryUrl("ep", "love-hz-vol-1", {
      legacyVideo: "videos/mixtapes-and-eps/love-hz-vol-1/love-hz-vol-1.mov",
      legacyImage: "images/mixtapes-and-eps/love-hz-vol-1/lovehz.jpg",
    }),
    faceType: "video",
  },
];

export function editionLabel(card) {
  return `1 of ${card.editionSize}`;
}

export function benefitsForCard(card) {
  const numbered = editionLabel(card);
  return [...COLLECTOR_CARD_BENEFITS.slice(0, 4), numbered, ...COLLECTOR_CARD_BENEFITS.slice(4)];
}
