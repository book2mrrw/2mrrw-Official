"use client";

import { Component } from "react";
import { unregisterModal } from "@/state/ui/modalStackStore";
import { clientLog } from "@/lib/observability/client-log";
import { ModalDismissToast } from "./FallbackRenderer";

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
 * Modal tree boundary — dismisses cleanly and releases scroll lock.
 */
export default class ModalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, showToast: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true, showToast: true };
  }

  componentDidCatch(error, errorInfo) {
    const { stackId, onClose } = this.props;
    if (stackId) unregisterModal(stackId);
    onClose?.();
    clientLog("error", "boundary_caught", {
      boundary: "ModalErrorBoundary",
      stackId,
      message: error?.message,
      componentStack: errorInfo?.componentStack,
    });
    logBoundaryTelemetry({
      type: "error.boundary.caught",
      boundary: "ModalErrorBoundary",
      error: error?.message || "unknown",
    });
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, showToast: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.state.showToast ? <ModalDismissToast /> : null;
    }
    return this.props.children;
  }
}
