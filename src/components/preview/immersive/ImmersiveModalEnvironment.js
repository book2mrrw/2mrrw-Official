"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { ImmersiveModalSkeleton } from "@/ui/skeletons";
import ImmersiveModalChrome from "@/components/preview/immersive/ImmersiveModalChrome";
import ImmersiveModalStage from "@/components/preview/immersive/ImmersiveModalStage";
import ImmersiveModalPanel from "@/components/preview/immersive/ImmersiveModalPanel";
import { MODAL_PANEL_ENTER, MODAL_STAGE_ENTER } from "@/components/preview/immersive/constants";

function ImmersiveModalEnvironment({
  contentReady,
  isMobile,
  glyphsOpen,
  desktopStageStyle,
  desktopStageMotion,
  stageProps,
  panelProps,
  onCloseClick,
  trackAccess,
  canStream,
  palette,
}) {
  if (!contentReady) {
    return <ImmersiveModalSkeleton isMobile={isMobile} />;
  }

  const stage = (
    <ImmersiveModalStage
      style={isMobile ? undefined : { flex: "none", maxHeight: "none", height: "100%" }}
      {...stageProps}
    />
  );

  const panel = <ImmersiveModalPanel isMobile={isMobile} {...panelProps} />;

  return (
    <>
      {isMobile ? (
        <ImmersiveModalChrome
          onCloseClick={onCloseClick}
          trackAccess={trackAccess}
          canStream={canStream}
          palette={palette}
        />
      ) : null}

      {isMobile ? (
        stage
      ) : (
        <motion.div
          key="preview-desktop-stage"
          className="immersive-desktop-stage-wrap"
          style={desktopStageStyle}
          initial={{ opacity: 0.85, scale: 0.96 }}
          animate={{
            opacity: 1,
            scale: 1,
            boxShadow: desktopStageMotion.boxShadow,
          }}
          transition={MODAL_STAGE_ENTER}
        >
          {stage}
        </motion.div>
      )}

      {isMobile ? (
        panel
      ) : (
        <motion.div
          key="preview-desktop-panel"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: glyphsOpen ? 0 : 1, y: glyphsOpen ? 10 : 0 }}
          transition={MODAL_PANEL_ENTER}
        >
          {panel}
        </motion.div>
      )}
    </>
  );
}

export default memo(ImmersiveModalEnvironment);
