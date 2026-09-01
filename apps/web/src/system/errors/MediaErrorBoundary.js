"use client";

import { Component } from "react";

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
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const { assetId = "unknown", mediaType = "unknown" } = this.props;
    console.error("[MediaErrorBoundary]", {
      assetId,
      mediaType,
      message: error?.message,
      componentStack: errorInfo?.componentStack,
    });
    logBoundaryTelemetry({
      type: "playback.failed",
      trackId: assetId,
      error: error?.message || "unknown",
    });
    this.props.onMediaError?.(error);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
