"use client";

import { Component } from "react";
import { clientLog } from "@/lib/observability/client-log";

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
 * Immersive player boundary — exits immersive cleanly via onExitImmersive.
 */
export default class ImmersiveErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    const { onExitImmersive } = this.props;
    onExitImmersive?.();
    clientLog("error", "boundary_caught", {
      boundary: "ImmersiveErrorBoundary",
      message: error?.message,
      componentStack: errorInfo?.componentStack,
    });
    logBoundaryTelemetry({
      type: "error.boundary.caught",
      boundary: "ImmersiveErrorBoundary",
      error: error?.message || "unknown",
    });
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
