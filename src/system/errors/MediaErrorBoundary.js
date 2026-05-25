"use client";

import { Component } from "react";
import { clientLog } from "@/lib/observability/client-log";
import { MediaErrorChrome } from "./FallbackRenderer";

function logBoundaryTelemetry(payload) {
  try {
    import("@/system/telemetry")
      .then(({ telemetry }) => {
        if (telemetry?.log) telemetry.log(payload);
      })
      .catch(() => {});
  } catch {
    /* optional */
  }
}

/**
 * Media engine boundary — preserves queue; does not crash player chrome.
 */
export default class MediaErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    const { assetId, mediaType } = this.props;
    clientLog("error", "boundary_caught", {
      boundary: "MediaErrorBoundary",
      assetId,
      mediaType,
      message: error?.message,
      componentStack: errorInfo?.componentStack,
    });
    logBoundaryTelemetry({
      type: "playback.failed",
      trackId: assetId || "unknown",
      error: error?.message || "unknown",
    });
    this.props.onMediaError?.(error);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return <MediaErrorChrome />;
    }
    return this.props.children;
  }
}
