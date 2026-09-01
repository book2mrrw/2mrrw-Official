// Cover palette hooks
export { useCoverPalette, paletteToCssVars, DEFAULT_PALETTE, isMotionCoverMedia, isVideoCoverFile } from "@/hooks/useCoverPalette";

// Global Media Controller — singleton coordinating audio + visual + video
export { globalMediaController, MEDIA_MODE, VISUAL_STATE } from "@/media/visualEngine/GlobalMediaController";

// Visual asset hooks & schema
export { useVisualAssets, invalidateVisualAssetsCache } from "@/hooks/useVisualAssets";
export { useVisualMomentGesture } from "@/hooks/useVisualMomentGesture";
export { useGlobalMediaControllerBridge } from "@/hooks/useGlobalMediaControllerBridge";
export {
  VISUAL_ASSET_TYPES,
  VISUAL_PLAYBACK_MODES,
  VISUAL_INTERACTIONS,
  VISUAL_ENTITLEMENT_TIERS,
  visualEntitlementSatisfied,
  resolveVisualEntitlementTier,
} from "@/lib/media/visual-asset-schema";
