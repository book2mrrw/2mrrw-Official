"use client";

import { Component } from "react";
import { unregisterModal } from "@/state/ui/modalStackStore";
import { clientLog } from "@/lib/observability/client-log";
import { ModalErrorFallback } from "./FallbackRenderer";

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
 * Modal tree boundary — recoverable fallback with retry/close; releases scroll lock.
 */
export default class ModalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this._loggedError = false;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    const { stackId } = this.props;
    if (stackId) unregisterModal(stackId);

    if (!this._loggedError) {
      this._loggedError = true;
      if (process.env.NODE_ENV !== "production") {
        console.error("[ModalErrorBoundary]", error?.message, errorInfo?.componentStack);
      }
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
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this._loggedError = false;
      this.setState({ hasError: false });
    }
  }

  handleRetry = () => {
    this._loggedError = false;
    this.setState({ hasError: false });
  };

  handleClose = () => {
    const { onClose, stackId } = this.props;
    if (stackId) unregisterModal(stackId);
    onClose?.();
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ModalErrorFallback
          message="This panel could not load. You can try again or close."
          onRetry={this.handleRetry}
          onClose={this.handleClose}
        />
      );
    }
    return this.props.children;
  }
}
